# Видеоэффекты фона (VYC-100) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить три режима обработки веб-камеры (оригинал / размытие / картинка-фон) в P2P и групповых звонках — эффект виден в локальном превью и собеседникам через `replaceTrack`.

**Architecture:** Канвас-конвейер на главном потоке: кадр → даунскейл 320×180 → MediaPipe Tasks ImageSegmenter (`selfie_multiclass_256x256`, WebGL/GPU) → мягкая confidence-маска фона → композит на canvas разрешения камеры (blur через `canvas.filter`, картинка через `drawImage` cover-fit) → `captureStream(0)` + `requestFrame()` (pull-режим). Подмена трека: единый `setCameraOutput()` в `call.ts` и `groupCall.ts` (replaceTrack на сендере + removeTrack/addTrack в localStream — всё, что читает `getVideoTracks()[0]`, видит актуальный трек). «Список фонов» — Go-эндпоинт, сканирующий каталог на диске.

**Tech Stack:** `@mediapipe/tasks-vision` 1.0.1 (wasm → `public/vision/`, загрузка через `fetch(file://)` — доказанный in-прод паттерн `audioAssetsUrl`), React 19 хуки, zustand (ручной localStorage-персист как в `mediaDeviceStore`), Vitest/jsdom, Go 1.22+ `ServeMux`.

## Global Constraints

- Режимы: только `'none' | 'blur' | 'image'`; `mode='none'` — нулевая нагрузка (0% GPU, канвас-цепочка не запускается).
- Аудио-треки движок и подмена НИКОГДА не трогают: подменяется только видео-трек.
- Сегментация только на 320×180. Композит — в разрешении камеры. Канвас: `captureStream(0)` + `requestFrame()`.
- Интерфейс хука — ровно по спеке: `useVideoEffects(input, mode, backgroundImageId, onTrack) → { output, status }`.
- Один `setCameraOutput(track | null)` в обеих службах; `null` возвращает исходный камерный трек.
- Go: `GET /api/v1/backgrounds` (RequireAuth) + `GET /backgrounds/{id}/file` (публичный, как `/uploads/`). JSON: `{"backgrounds":[{"id","name","url"}]}`.
- Ассеты движка в `public/vision/` (commitится, как `public/audio`), `asarUnpack: dist/vision/**`, IPC `get-vision-assets-url-sync` (dev → `/vision/`, prod → `file://…app.asar.unpacked/dist/vision/`).
- Неудача модели → `status:'error'`, хук отдаёт исходный поток, приложение не падает.
- Гейты: `npx tsc --noEmit` → 0 байт; `npx stylelint "src/**/*.css"` → 0 байт; `npm run check:i18n` → чисто; `npm test` → ровно 3 известных фейла в `api.network-retry.test.ts`, новых нет. Go: `make test`/`make vet`/`make lint`. **Все npm-команды из `client/`, Go-команды из корня репо.**
- Никогда `git add -A` (в корне лежит untracked `design_handoff_discord_redesign/`) — только явные пути.

---

### Task 1: Go — конфиг, хендлер фонов, роуты, тесты

**Files:**
- Modify: `server/internal/config/config.go` (структура + `New()`)
- Create: `server/internal/delivery/http/handler/background.go`
- Create: `server/internal/delivery/http/handler/background_test.go`
- Modify: `server/cmd/api/main.go` (импорт не нужен — package уже импортирован; роуты + инстанциация)

**Interfaces:**
- Produces: `handler.NewBackgroundHandler(dir, prefix string, log *slog.Logger) *BackgroundHandler` с методами `ListBackgrounds(w, r)` и `ServeFile(w, r)`; `config.Config.BackgroundsDir string`, `config.Config.BackgroundsURLPrefix string`.

- [ ] **Step 1: Добавить поля в конфиг**

В `server/internal/config/config.go`, в struct `Config` после поля `UploadDir string` (строка 28) добавить:

```go
	// BackgroundsDir — каталог картинок-фонов для видеозвонков (jpg/jpeg/png/webp).
	// BackgroundsURLPrefix — префикс публичной раздачи файлов фонов.
	BackgroundsDir       string
	BackgroundsURLPrefix string
```

В `New()` (после строки `UploadDir: getEnv("UPLOAD_DIR", "./uploads"),`, ~строка 123):

```go
		BackgroundsDir:       getEnv("BACKGROUNDS_DIR", "./backgrounds"),
		BackgroundsURLPrefix: getEnv("BACKGROUNDS_URL_PREFIX", "/backgrounds"),
```

- [ ] **Step 2: Написать хендлер**

Создать `server/internal/delivery/http/handler/background.go`:

```go
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
	sort.Slice(items, func(i, j int) bool { return items[i].ID < items[j].ID })
	h.sendJSON(w, http.StatusOK, map[string]any{"backgrounds": items})
}

// resolvePath ищет в каталоге файл с именем "<id><допустимое расширение>".
// Для картинки расширение извне неизвестно, поэтому перебираем каталог; это же
// делает подмену невозможной: путь всегда строится из имени реального файла.
func (h *BackgroundHandler) resolvePath(id string) (string, bool) {
	if id == "" || strings.ContainsAny(id, `/\..`) {
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
// слать Authorization (тот же резон, что у /uploads/).
func (h *BackgroundHandler) ServeFile(w http.ResponseWriter, r *http.Request) {
	path, ok := h.resolvePath(r.PathValue("id"))
	if !ok {
		http.NotFound(w, r)
		return
	}
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
```

- [ ] **Step 3: Написать тесты**

Создать `server/internal/delivery/http/handler/background_test.go`:

```go
package handler

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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
```

Не забыть: добавить `"strings"` в импорты теста (используется в `TestListBackgroundsEmptyDir`). Финальный блок импортов теста:

```go
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
```

- [ ] **Step 4: Прогнать тесты нового файла**

Из корня репо:

```bash
go test ./internal/delivery/http/handler/ -run 'Background' -v
```

Expected: FAIL — `background.go` ещё нет → «undefined: NewBackgroundHandler».

- [ ] **Step 5: Прописать роуты в main.go**

В `server/cmd/api/main.go`, рядом со статикой загрузок (после строки `router.Handle("GET /uploads/", newUploadsHandler(cfg.UploadDir))`, ~строка 423):

```go
	// Виртуальные фоны видеозвонков (VYC-100). Список — под авторизацией;
	// файлы — публично: <img src> не умеет слать Authorization (как /uploads/).
	backgroundHandler := handler.NewBackgroundHandler(cfg.BackgroundsDir, cfg.BackgroundsURLPrefix, log)
	router.HandleFunc("GET /api/v1/backgrounds", authMid.RequireAuth(backgroundHandler.ListBackgrounds))
	router.HandleFunc("GET /backgrounds/{id}/file", backgroundHandler.ServeFile)
```

- [ ] **Step 6: Прогнать тесты**

```bash
go test ./... 2>&1 | tail -5
```

Expected: `ok` по всем пакетам, 0 failures.

- [ ] **Step 7: vet и lint**

```bash
make vet && make lint
```

- [ ] **Step 8: Commit**

```bash
git add server/internal/config/config.go server/internal/delivery/http/handler/background.go server/internal/delivery/http/handler/background_test.go server/cmd/api/main.go
git commit -m "VYC-100 Бэкенд: список и раздача виртуальных фонов звонка"
```

---

### Task 2: Клиент — fetchBackgrounds в api.ts + типы

**Files:**
- Modify: `client/src/services/api.ts`
- Create: `client/src/services/__tests__/backgroundsApi.test.ts`

**Interfaces:**
- Produces: `export interface CallBackground { id: string; name: string; url: string }` (в `src/types` нет — держим рядом с API) и `apiService.fetchBackgrounds(): Promise<CallBackground[]>` — возвращает сырые элементы, `url` ОТНОСИТЕЛЬНЫЙ (абсолютный резолв делает стор, Task 3).

- [ ] **Step 1: Написать падающий тест**

Создать `client/src/services/__tests__/backgroundsApi.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiService } from '@/services/api';

function stubFetch(body: unknown, status = 200): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })));
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('apiService.fetchBackgrounds', () => {
  it('разбирает ответ сервера в список фонов', async () => {
    stubFetch({ backgrounds: [
      { id: 'ocean', name: 'ocean', url: '/backgrounds/ocean/file' },
      { id: 'alps', name: 'alps', url: '/backgrounds/alps/file' },
    ] });
    const list = await apiService.fetchBackgrounds();
    expect(list).toEqual([
      { id: 'ocean', name: 'ocean', url: '/backgrounds/ocean/file' },
      { id: 'alps', name: 'alps', url: '/backgrounds/alps/file' },
    ]);
  });

  it('пустой список — это []', async () => {
    stubFetch({ backgrounds: [] });
    await expect(apiService.fetchBackgrounds()).resolves.toEqual([]);
  });

  it('пробрасывает ApiError на ошибку сервера', async () => {
    stubFetch({ error: 'boom', code: 'internal' }, 500);
    await expect(apiService.fetchBackgrounds()).rejects.toMatchObject({ code: 'internal' });
  });
});
```

- [ ] **Step 2: Прогнать — ожидаем fail**

Из `client/`: `npx vitest run src/services/__tests__/backgroundsApi.test.ts`
Expected: FAIL — `fetchBackgrounds is not a function`.

- [ ] **Step 3: Реализовать в api.ts**

В `client/src/services/api.ts`:
- В блок импортов типов (строка 2) добавить тип в список — `CallBackground` объявляется прямо в api.ts (рядом с `OtpVerifyResponse`, строка 44):

```ts
/** Элемент списка виртуальных фонов (VYC-100). url — относительный; абсолютный резолв делает стор. */
export interface CallBackground {
  id: string;
  name: string;
  url: string;
}
```

- В конец класса `ApiService`, после `getAttachment` (строка 813), перед закрывающей `}`:

```ts
  // Backgrounds (VYC-100)
  async fetchBackgrounds(): Promise<CallBackground[]> {
    const data = await this.request<{ backgrounds: CallBackground[] }>('/api/v1/backgrounds');
    return data.backgrounds ?? [];
  }
```

- [ ] **Step 4: Прогнать тест**

`npx vitest run src/services/__tests__/backgroundsApi.test.ts`
Expected: PASS (3 теста).

- [ ] **Step 5: Типчекаем и коммитим**

```bash
npx tsc --noEmit && git add src/services/api.ts src/services/__tests__/backgroundsApi.test.ts && git commit -m "VYC-100 Клиент: fetchBackgrounds в api.ts"
```

---

### Task 3: Клиент — backgroundStore (zustand + персист)

**Files:**
- Create: `client/src/stores/backgroundStore.ts`
- Create: `client/src/stores/__tests__/backgroundStore.test.ts`

**Interfaces:**
- Produces:
  - `export type BackgroundMode = 'none' | 'blur' | 'image'`
  - `export type BackgroundListStatus = 'idle' | 'loading' | 'ready' | 'error'`
  - `useBackgroundStore`: `{ mode, backgroundId, list: CallBackground[] | null, listStatus, setMode(mode), setBackground(id | null), fetchBackgrounds(): Promise<void>, urlById(id): string | null, resolveUrl(url): string }`
  - `STORAGE_KEY = 'vycord_background'` — персист `{mode, backgroundId}`.
- Consumes: `apiService.fetchBackgrounds()` (Task 2), `API_BASE_URL` (уже в api.ts).

- [ ] **Step 1: Написать падающие тесты**

Создать `client/src/stores/__tests__/backgroundStore.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { apiService } from '@/services/api';

vi.mock('@/services/api', () => ({
  apiService: {
    fetchBackgrounds: vi.fn(),
  },
  API_BASE_URL: 'http://api.test',
}));

const mockedFetch = vi.mocked(apiService.fetchBackgrounds);

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  mockedFetch.mockReset();
});

describe('backgroundStore: режим и фон', () => {
  it('setMode и setBackground пишут в стор и персистятся', async () => {
    const { useBackgroundStore } = await import('@/stores/backgroundStore');
    useBackgroundStore.getState().setMode('blur');
    useBackgroundStore.getState().setBackground('ocean');
    expect(useBackgroundStore.getState().mode).toBe('blur');
    expect(useBackgroundStore.getState().backgroundId).toBe('ocean');
    expect(JSON.parse(localStorage.getItem('vycord_background')!)).toEqual({
      mode: 'blur', backgroundId: 'ocean',
    });

    vi.resetModules();
    const { useBackgroundStore: fresh } = await import('@/stores/backgroundStore');
    expect(fresh.getState().mode).toBe('blur');
    expect(fresh.getState().backgroundId).toBe('ocean');
  });

  it('невалидный localStorage не ломает init', async () => {
    localStorage.setItem('vycord_background', '{broken');
    const { useBackgroundStore } = await import('@/stores/backgroundStore');
    expect(useBackgroundStore.getState().mode).toBe('none');
    expect(useBackgroundStore.getState().backgroundId).toBeNull();
  });
});

describe('backgroundStore: fetchBackgrounds', () => {
  it('заполняет список, резолвит url и статус ready', async () => {
    mockedFetch.mockResolvedValue([
      { id: 'ocean', name: 'ocean', url: '/backgrounds/ocean/file' },
    ]);
    const { useBackgroundStore } = await import('@/stores/backgroundStore');
    await useBackgroundStore.getState().fetchBackgrounds();
    const s = useBackgroundStore.getState();
    expect(s.listStatus).toBe('ready');
    expect(s.list).toEqual([{ id: 'ocean', name: 'ocean', url: 'http://api.test/backgrounds/ocean/file' }]);
    expect(s.urlById('ocean')).toBe('http://api.test/backgrounds/ocean/file');
    expect(s.urlById('nope')).toBeNull();
  });

  it('повторный fetch при готовом списке не ходит в сеть', async () => {
    mockedFetch.mockResolvedValue([]);
    const { useBackgroundStore } = await import('@/stores/backgroundStore');
    await useBackgroundStore.getState().fetchBackgrounds();
    await useBackgroundStore.getState().fetchBackgrounds();
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('ошибка сети → listStatus error без проброса', async () => {
    mockedFetch.mockRejectedValue(new Error('net'));
    const { useBackgroundStore } = await import('@/stores/backgroundStore');
    await expect(useBackgroundStore.getState().fetchBackgrounds()).resolves.toBeUndefined();
    expect(useBackgroundStore.getState().listStatus).toBe('error');
  });
});
```

- [ ] **Step 2: Прогнать — ожидаем fail**

`npx vitest run src/stores/__tests__/backgroundStore.test.ts`
Expected: FAIL — модуль не существует.

- [ ] **Step 3: Реализовать стор**

Создать `client/src/stores/backgroundStore.ts`:

```ts
import { create } from 'zustand';
import { apiService } from '@/services/api';
import { API_BASE_URL, type CallBackground } from '@/services/api';

export type BackgroundMode = 'none' | 'blur' | 'image';
export type BackgroundListStatus = 'idle' | 'loading' | 'ready' | 'error';

export const BACKGROUND_MODES: BackgroundMode[] = ['none', 'blur', 'image'];

const STORAGE_KEY = 'vycord_background';
const DEFAULT_MODE: BackgroundMode = 'none';

interface PersistedBackgroundPrefs {
  mode: BackgroundMode;
  backgroundId: string | null;
}

function loadPrefs(): PersistedBackgroundPrefs {
  const result: PersistedBackgroundPrefs = { mode: DEFAULT_MODE, backgroundId: null };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return result;
    const parsed = JSON.parse(raw) as Partial<PersistedBackgroundPrefs>;
    if (BACKGROUND_MODES.includes(parsed.mode as BackgroundMode)) result.mode = parsed.mode as BackgroundMode;
    if (typeof parsed.backgroundId === 'string') result.backgroundId = parsed.backgroundId;
  } catch {
    // Невалидный JSON — начинаем с дефолтов.
  }
  return result;
}

function persistPrefs(prefs: PersistedBackgroundPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Storage недоступен — преференсы живут до перезагрузки.
  }
}

/** Относительный url с сервера → абсолютный (резолв против API_BASE_URL). */
export function resolveBackgroundUrl(url: string): string {
  return url.startsWith('/') ? `${API_BASE_URL}${url}` : url;
}

interface BackgroundState {
  /** Выбранный пользователем режим (персист). */
  mode: BackgroundMode;
  /** Выбранный фон (персист, применятся только при mode='image'). */
  backgroundId: string | null;
  /** Список фонов с сервера, url уже абсолютные. */
  list: CallBackground[] | null;
  listStatus: BackgroundListStatus;
  setMode: (mode: BackgroundMode) => void;
  setBackground: (id: string | null) => void;
  fetchBackgrounds: () => Promise<void>;
  urlById: (id: string) => string | null;
}

function applyPrefs(prefs: PersistedBackgroundPrefs): Pick<BackgroundState, 'mode' | 'backgroundId'> {
  return { mode: prefs.mode, backgroundId: prefs.backgroundId };
}

export const useBackgroundStore = create<BackgroundState>((set, get) => ({
  ...applyPrefs(loadPrefs()),
  list: null,
  listStatus: 'idle',

  setMode: (mode) => {
    set({ mode });
    persistPrefs({ mode, backgroundId: get().backgroundId });
  },

  setBackground: (backgroundId) => {
    set({ backgroundId });
    persistPrefs({ mode: get().mode, backgroundId });
  },

  fetchBackgrounds: async () => {
    if (get().list !== null) return;
    set({ listStatus: 'loading' });
    try {
      const raw = await apiService.fetchBackgrounds();
      const list = raw.map((b) => ({ ...b, url: resolveBackgroundUrl(b.url) }));
      set({ list, listStatus: 'ready' });
      // Выбранный фон исчез с сервера — сбрасываем выбор, чтобы UI не
      // показывал мёртвую миниатюру.
      const { backgroundId } = get();
      if (backgroundId !== null && !list.some((b) => b.id === backgroundId)) {
        get().setBackground(null);
      }
    } catch {
      set({ listStatus: 'error' });
    }
  },

  urlById: (id) => {
    const found = get().list?.find((b) => b.id === id);
    return found ? found.url : null;
  },
}));
```

- [ ] **Step 4: Прогнать тесты**

`npx vitest run src/stores/__tests__/backgroundStore.test.ts`
Expected: PASS (5 тестов).

- [ ] **Step 5: Типчек + коммит**

```bash
npx tsc --noEmit && git add src/stores/backgroundStore.ts src/stores/__tests__/backgroundStore.test.ts && git commit -m "VYC-100 Клиент: стор выбора фона звонка"
```

---

### Task 4: Ассеты — mediapipe в package.json, public/vision/, IPC в Electron

**Files:**
- Modify: `client/package.json` (dependency + скрипт + asarUnpack)
- Create: `client/scripts/copy-mediapipe-assets.mjs`
- Modify: `client/electron/main.ts`, `client/electron/preload.ts`
- Modify: `client/src/types/electron.d.ts`
- Create: `client/public/vision/` (wasm + tflite, commitится — как `public/audio`)

**Interfaces:**
- Produces: `window.electronAPI.visionAssetsUrl: string` (dev: `'/vision/'`, prod: `'file://…/app.asar.unpacked/dist/vision/'`); файлы: `public/vision/vision_wasm_internal.{js,wasm}`, `public/vision/selfie_multiclass_256x256.tflite`.

- [ ] **Step 1: Добавить зависимость**

Из `client/`:

```bash
npm install @mediapipe/tasks-vision
```

(версия 1.0.1; была установлена ранее с `--no-save` только для ресёрча).

- [ ] **Step 2: Написать скрипт копирования**

Создать `client/scripts/copy-mediapipe-assets.mjs` (паттерн `copy-audio-assets`, но отдельным .mjs — как `check-i18n.mjs`):

```js
// Копирует wasm MediaPipe Tasks из node_modules и скачивает модель
// selfie_multiclass_256x256 в public/vision/ (в dev vite раздаёт public/
// с корня; в проде файлы попадают в dist/vision/, откуда их грузит IPC
// get-vision-assets-url-sync).
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wasmSrc = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const dst = join(root, 'public/vision');
const modelUrl =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite';
const modelDst = join(dst, 'selfie_multiclass_256x256.tflite');

mkdirSync(dst, { recursive: true });
cpSync(wasmSrc, dst, { recursive: true });

if (existsSync(modelDst)) {
  console.log('copy-mediapipe-assets: модель уже на месте, пропускаю download');
} else {
  const res = await fetch(modelUrl);
  if (!res.ok) throw new Error(`model download failed: HTTP ${res.status}`);
  writeFileSync(modelDst, Buffer.from(await res.arrayBuffer()));
  console.log('copy-mediapipe-assets: selfie_multiclass_256x256.tflite скачана');
}

const files = readFileSync(join(dst, 'vision_wasm_internal.js'), 'utf8').length > 0;
if (!files) throw new Error('vision_wasm_internal.js не скопировался');
console.log('copy-mediapipe-assets: OK');
```

- [ ] **Step 3: Скачать модель прямо сейчас (файл ляжет в git)**

```bash
mkdir -p public/vision && cp node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.js node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm public/vision/ && node scripts/copy-mediapipe-assets.mjs
```

Обфускаторный баг не ждём: после отработки скрипта проверить:

```bash
ls -la public/vision/
```

Expected: `vision_wasm_internal.js`, `vision_wasm_internal.wasm`, `selfie_multiclass_256x256.tflite` (~1.3 МБ), плюс остальные `vision_wasm_*` из wasm/.

- [ ] **Step 4: package.json — скрипт и asarUnpack**

В `client/package.json`:
- В `scripts` после `"copy-audio-assets"` (та же строка-массив) добавить:

```json
    "copy-mediapipe-assets": "node scripts/copy-mediapipe-assets.mjs",
```

- В `build:vite` подставить перед `vite build`:

```json
    "build:vite": "npm run copy-audio-assets && npm run copy-mediapipe-assets && tsc && vite build",
```

- В `build.asarUnpack` массив дополнить:

```json
      "dist/audio/**",
      "dist/vision/**"
```

- [ ] **Step 5: IPC в Electron main**

В `client/electron/main.ts`, сразу после блока `get-audio-assets-url-sync` (строки 170-182):

```ts
// Sync IPC: каталог wasm/модели MediaPipe Video Background (VYC-100).
// В проде файлы лежат в app.asar.unpacked (asarUnpack), потому что
// fetch(file://) из asar в вашей версии Chromium не работает. В dev —
// это просто каталог public/, который раздаёт vite.
ipcMain.on('get-vision-assets-url-sync', (event) => {
  if (isDev) {
    event.returnValue = '/vision/';
    return;
  }
  const visionDir = path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'vision');
  event.returnValue = `file://${visionDir.replace(/\\/g, '/')}/`;
});
```

- [ ] **Step 6: preload**

В `client/electron/preload.ts`, после строки 5 (audioAssetsUrl):

```ts
// Sync IPC: то же для wasm+модели MediaPipe (VYC-100), рендерер фетчит
// файлы напрямую — как уже делает audioAssetsUrl (noiseCancellation.ts).
const visionAssetsUrl: string = ipcRenderer.sendSync('get-vision-assets-url-sync');
```

И в объекте `contextBridge.exposeInMainWorld('electronAPI', {...})` после `audioAssetsUrl,`:

```ts
  visionAssetsUrl,
```

- [ ] **Step 7: Тип глобального объекта**

В `client/src/types/electron.d.ts`, после `audioAssetsUrl: string;` (строка 36):

```ts
  /** Базовый URL каталога wasm/модели MediaPipe Video Background (VYC-100). */
  visionAssetsUrl: string;
```

- [ ] **Step 8: Проверки + коммит**

```bash
npx tsc --noEmit && npm run dev:electron:build
```

(tsc по electron/tsconfig собирает electron-dist — проверяет, что preload/main компилируются.)

```bash
git add package.json package-lock.json scripts/copy-mediapipe-assets.mjs electron/main.ts electron/preload.ts src/types/electron.d.ts public/vision && git commit -m "VYC-100 Ассеты MediaPipe и IPC для загрузки wasm/модели"
```

---

### Task 5: Чистые функции движка + юнит-тесты

**Files:**
- Create: `client/src/services/videoBackground.ts` — пока только pure-помощники + константы (движок добавит Task 6)
- Create: `client/src/services/__tests__/videoBackground.test.ts`

**Interfaces:**
- Produces (экспорт из `src/services/videoBackground.ts`):
  - `export type BackgroundMode = 'none' | 'blur' | 'image'`
  - `export type VideoBackgroundStatus = 'idle' | 'loading' | 'ready' | 'error'`
  - `export const SEGMENT_WIDTH = 320; SEGMENT_HEIGHT = 180; BLUR_RADIUS = 14;`
  - `export function coverFit(imageW, imageH, frameW, frameH): { x, y, w, h } | null`
  - `export function fillPersonAlpha(rgba: Uint8ClampedArray, backgroundConfidence: Float32Array, length: number): void`
  - `export function backgroundLabelIndex(labels: string[]): number`

- [ ] **Step 1: Написать падающие тесты**

Создать `client/src/services/__tests__/videoBackground.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  backgroundLabelIndex,
  coverFit,
  fillPersonAlpha,
} from '@/services/videoBackground';

describe('coverFit', () => {
  it('вписывает изображение в контейнер по большей оси', () => {
    // 1000×500 в 640×480: масштаб по высоте 480/500=0.96 → ширина 960
    const r = coverFit(1000, 500, 640, 480);
    expect(r).toEqual({ x: (640 - 960) / 2, y: 0, w: 960, h: 480 });
  });

  it('не трогает ровно подходящее изображение', () => {
    expect(coverFit(640, 480, 640, 480)).toEqual({ x: 0, y: 0, w: 640, h: 480 });
  });

  it('возвращает null на нулевых размерах', () => {
    expect(coverFit(0, 500, 640, 480)).toBeNull();
    expect(coverFit(1000, 0, 640, 480)).toBeNull();
    expect(coverFit(1000, 500, 0, 480)).toBeNull();
  });
});

describe('fillPersonAlpha', () => {
  it('конвертирует confidence фона в альфу человека', () => {
    const rgba = new Uint8ClampedArray(4 * 3);
    rgba[0] = 255; rgba[1] = 255; rgba[2] = 255; // RGB выставляются один раз
    rgba[4] = 255; rgba[5] = 255; rgba[6] = 255;
    rgba[8] = 255; rgba[9] = 255; rgba[10] = 255;
    fillPersonAlpha(rgba, new Float32Array([0.0, 1.0, 0.25]), 3);
    expect([rgba[3], rgba[7], rgba[11]]).toEqual([255, 0, 191]); // 0.75*255=191.25→191
  });

  it('обрывается по длине массива mask', () => {
    const rgba = new Uint8ClampedArray(4 * 4);
    rgba[15] = 99; // «мусор» за пределами mask — не должен трогаться
    fillPersonAlpha(rgba, new Float32Array([1.0]), 4);
    expect(rgba[15]).toBe(99);
  });
});

describe('backgroundLabelIndex', () => {
  it('находит индекс класса background', () => {
    expect(backgroundLabelIndex(['background', 'hair', 'skin', 'clothes'])).toBe(0);
    expect(backgroundLabelIndex(['hair', 'skin', 'clothes', 'background'])).toBe(3);
    expect(backgroundLabelIndex(['foo', 'bar'])).toBe(0); // fallback на 0
    expect(backgroundLabelIndex([])).toBe(0);
  });
});
```

- [ ] **Step 2: Прогнать — ожидаем fail**

`npx vitest run src/services/__tests__/videoBackground.test.ts`
Expected: FAIL — модуль не существует.

- [ ] **Step 3: Реализовать чистые функции**

Создать `client/src/services/videoBackground.ts` (полный файл пока что состоит из этого; Task 6 добавит движок в тот же файл):

```ts
import {
  FilesetResolver,
  ImageSegmenter,
  type ImageSegmenterResult,
} from '@mediapipe/tasks-vision';

export type BackgroundMode = 'none' | 'blur' | 'image';
export type VideoBackgroundStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Разрешение кадра для сегментации. Меньше модель — быстрее инференс;
 *  маска апскейлится в canvas камеры через drawImage (GPU, мягкие края). */
export const SEGMENT_WIDTH = 320;
export const SEGMENT_HEIGHT = 180;
export const BLUR_RADIUS = 14;

/** Базовый URL wasm/модели: в проде его подставляет Electron IPC
 *  (get-vision-assets-url-sync, как audioAssetsUrl). */
export const VISION_ASSETS_BASE: string =
  (globalThis as { electronAPI?: { visionAssetsUrl?: string } }).electronAPI?.visionAssetsUrl
  ?? '/vision/';

export interface CoverFitRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * cover-fit: вписать изображение imageW×imageH в контейнер frameW×frameH,
 * сохранив пропорции. Возвращает null на некорректных размерах.
 */
export function coverFit(imageW: number, imageH: number, frameW: number, frameH: number): CoverFitRect | null {
  if (imageW <= 0 || imageH <= 0 || frameW <= 0 || frameH <= 0) return null;
  const scale = Math.max(frameW / imageW, frameH / imageH);
  const w = imageW * scale;
  const h = imageH * scale;
  return { x: (frameW - w) / 2, y: (frameH - h) / 2, w, h };
}

/**
 * Заполняет альфа-канал RGBA-буфера вероятностью «человек» из confidence-маски
 * фона: alpha = 1 - backgroundConfidence. RGB вызывающий заполняет один раз
 * (255,255,255): используется только альфа (destination-in). length — число
 * пикселей; лишние пиксели rgba не трогаются.
 */
export function fillPersonAlpha(rgba: Uint8ClampedArray, backgroundConfidence: Float32Array, length: number): void {
  const len = Math.min(Math.floor(rgba.length / 4), backgroundConfidence.length, length);
  for (let i = 0; i < len; i++) {
    rgba[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(255 * (1 - backgroundConfidence[i]))));
  }
}

/**
 * Индекс класса «фон» в метках модели (selfie_multiclass: background первый).
 * Если фон не найден — 0: у моделей сегментации фон идёт нулевым классом.
 */
export function backgroundLabelIndex(labels: string[]): number {
  const idx = labels.findIndex((l) => l.toLowerCase().includes('background'));
  return idx >= 0 ? idx : 0;
}
```

> Примечание: в этом файле импорты `FilesetResolver`/`ImageSegmenter` пока не используются — использует движок Task 6. Чтобы не оставлять неиспользуемые импорты (tsc `noUnusedLocals`?), они появятся в Task 6: на этом шаге импорт не добавляйте.

- [ ] **Step 4: Прогнать тесты**

`npx vitest run src/services/__tests__/videoBackground.test.ts`
Expected: PASS (3 describe-блока).

- [ ] **Step 5: Типчек + коммит**

```bash
npx tsc --noEmit && git add src/services/videoBackground.ts src/services/__tests__/videoBackground.test.ts && git commit -m "VYC-100 Чистые функции пайплайна фона (cover-fit, маска, метки)"
```

---

### Task 6: Движок VideoBackgroundEngine

**Files:**
- Modify: `client/src/services/videoBackground.ts` (добавить импорты FilesetResolver/ImageSegmenter/ImageSegmenterResult + класс)

**Interfaces:**
- Consumes: `coverFit`, `fillPersonAlpha`, `backgroundLabelIndex`, `SEGMENT_WIDTH/HEIGHT`, `BLUR_RADIUS`, `VISION_ASSETS_BASE` (Task 5).
- Produces:
  - `class VideoBackgroundEngine`:
    - `constructor(opts?: { assetsBase?: string })`
    - `onStatusChange: ((s: VideoBackgroundStatus) => void) | null`
    - `get status(): VideoBackgroundStatus`
    - `get hasEffect(): boolean` — движок готов и рисует эффект (mode ≠ none, модель готова, инпут есть).
    - `get outputTrack(): MediaStreamTrack | null` — канвас-трек, если конвейер построен.
    - `async setInput(stream: MediaStream | null): Promise<void>`
    - `async setMode(mode: BackgroundMode, backgroundUrl: string | null): Promise<void>`
    - `dispose(): void`
  - Движок никогда не кладёт аудио в output-трек; оригинальные аудио-треки хук добавляет сам.

- [ ] **Step 1: Написать код движка (без тестов — GPU/медиа не покрываются юнитами; поведение доказывает ручная проверка Task 11 + мок-тесты хука в Task 7)**

За`client/src/services/videoBackground.ts` заменить (файл уже существует с помощниками — просто продолжить):

Импорты (заменить верхний блок):

```ts
import {
  FilesetResolver,
  ImageSegmenter,
  type ImageSegmenterResult,
} from '@mediapipe/tasks-vision';
```

В конец файла добавить:

```ts
interface VideoBackgroundEngineOptions {
  assetsBase?: string;
}

/**
 * Пайплайн эффекта фона: кадр камеры → даунскейл → сегментация (MediaPipe,
 * GPU) → маска → композит (blur-фон или картинка cover-fit) → канвас-трек.
 *
 * Режим 'none' = полный простой: rAF-луп не запускается, канвас не создан
 * заново, GPU не трогается. Владельцами input-треков движок никогда не
 * является: ни один входной трек не стопается.
 */
export class VideoBackgroundEngine {
  onStatusChange: ((status: VideoBackgroundStatus) => void) | null = null;

  private readonly assetsBase: string;
  private readonly bgCache = new Map<string, HTMLImageElement>();
  private segmenter: ImageSegmenter | null = null;
  private labelIndex = 0;
  private inputVideo: HTMLVideoElement | null = null;
  private inputStream: MediaStream | null = null;
  private segCanvas: HTMLCanvasElement | null = null;
  private maskCanvas: HTMLCanvasElement | null = null;
  private maskImageData: ImageData | null = null;
  private compositeCanvas: HTMLCanvasElement | null = null;
  private compositeCtx: CanvasRenderingContext2D | null = null;
  private personCanvas: HTMLCanvasElement | null = null;
  private personCtx: CanvasRenderingContext2D | null = null;
  private captureTrack: CanvasCaptureMediaStreamTrack | null = null;
  private mode: BackgroundMode = 'none';
  private backgroundUrl: string | null = null;
  private rafId = 0;
  private disposed = false;
  private currentStatus: VideoBackgroundStatus = 'idle';

  constructor(options: VideoBackgroundEngineOptions = {}) {
    this.assetsBase = options.assetsBase ?? VISION_ASSETS_BASE;
  }

  get status(): VideoBackgroundStatus {
    return this.currentStatus;
  }

  get hasEffect(): boolean {
    return (
      !this.disposed
      && this.mode !== 'none'
      && this.segmenter !== null
      && this.inputVideo !== null
      && this.inputStream !== null
      && this.compositeCanvas !== null
      && this.captureTrack !== null
      && this.captureTrack.readyState === 'live'
    );
  }

  /** Канвас-трек для подмены в звонке; null, пока конвейер не построен. */
  get outputTrack(): MediaStreamTrack | null {
    return this.hasEffect ? this.captureTrack : null;
  }

  private setStatus(status: VideoBackgroundStatus): void {
    if (this.currentStatus === status) return;
    this.currentStatus = status;
    this.onStatusChange?.(status);
  }

  /** Идемпотентно грузит wasm + модель (GPU, при ошибке — CPU). */
  private async loadModel(): Promise<void> {
    if (this.segmenter) return;
    this.setStatus('loading');
    try {
      const fileset = await FilesetResolver.forVisionTasks(this.assetsBase);
      this.segmenter = await this.createSegmenter(fileset, 'GPU').catch(() =>
        this.createSegmenter(fileset, 'CPU'),
      );
      this.labelIndex = backgroundLabelIndex(this.segmenter.getLabels());
      this.setStatus('ready');
    } catch {
      this.segmenter?.close();
      this.segmenter = null;
      this.setStatus('error');
    }
  }

  private createSegmenter(fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>, delegate: 'GPU' | 'CPU') {
    return ImageSegmenter.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: `${this.assetsBase}selfie_multiclass_256x256.tflite`,
        delegate,
      },
      runningMode: 'VIDEO',
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    });
  }

  /**
   * Меняет входной поток. Сохраняет режим: если эффект активен — строит
   * конвейер заново.
   */
  async setInput(stream: MediaStream | null): Promise<void> {
    if (this.inputStream === stream) return;
    this.inputStream = stream;
    this.stopLoop();
    this.teardownPipeline();

    if (!stream) return;
    const camera = stream.getVideoTracks()[0];
    if (!camera) return;

    const video = this.inputVideo ?? document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    // На беззвучный локальный элемент не действует автовоспроизведение-политика;
    // play() зовём руками, чтобы ошибка не молчала.
    video.srcObject = new MediaStream([camera]);
    this.inputVideo = video;
    await video.play().catch(() => {});
    this.canvasSizeFromVideo();

    if (this.mode !== 'none') {
      await this.loadModel();
      const bg = this.backgroundUrl;
      if (bg) void this.ensureBackground(bg);
      this.startLoop();
    }
  }

  async setMode(mode: BackgroundMode, backgroundUrl: string | null): Promise<void> {
    if (this.mode === mode && this.backgroundUrl === backgroundUrl) return;
    this.mode = mode;
    this.backgroundUrl = mode === 'image' ? backgroundUrl : null;

    if (mode === 'none' || !this.inputStream) {
      this.stopLoop();
      return;
    }
    if (!this.segmenter) {
      await this.loadModel();
      if (!this.segmenter) return; // status 'error'
    }
    if (this.backgroundUrl) void this.ensureBackground(this.backgroundUrl);
    this.canvasSizeFromVideo();
    this.startLoop();
  }

  /** Размер канваса из актуального видео-кадра; повторяется при metadata. */
  private canvasSizeFromVideo(): void {
    const video = this.inputVideo;
    if (!video) return;
    const w = Math.max(1, video.videoWidth);
    const h = Math.max(1, video.videoHeight);
    if (!this.compositeCanvas || this.compositeCanvas.width !== w || this.compositeCanvas.height !== h) {
      this.teardownPipeline();
      this.buildPipeline(w, h);
    }
  }

  private buildPipeline(width: number, height: number): void {
    const seg = document.createElement('canvas');
    seg.width = SEGMENT_WIDTH;
    seg.height = SEGMENT_HEIGHT;

    const mask = document.createElement('canvas');
    mask.width = SEGMENT_WIDTH;
    mask.height = SEGMENT_HEIGHT;

    const imageData = mask.getContext('2d')!.createImageData(SEGMENT_WIDTH, SEGMENT_HEIGHT);
    for (let i = 0; i < imageData.data.length; i += 4) {
      imageData.data[i] = 255;
      imageData.data[i + 1] = 255;
      imageData.data[i + 2] = 255;
    }

    const composite = document.createElement('canvas');
    composite.width = width;
    composite.height = height;

    const person = document.createElement('canvas');
    person.width = width;
    person.height = height;

    this.segCanvas = seg;
    this.maskCanvas = mask;
    this.maskImageData = imageData;
    this.compositeCanvas = composite;
    this.compositeCtx = composite.getContext('2d');
    this.personCanvas = person;
    this.personCtx = person.getContext('2d');

    const stream = composite.captureStream(0);
    this.captureTrack = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  }

  private teardownPipeline(): void {
    this.captureTrack?.stop();
    this.captureTrack = null;
    this.segCanvas = null;
    this.maskCanvas = null;
    this.maskImageData = null;
    this.compositeCanvas = null;
    this.compositeCtx = null;
    this.personCanvas = null;
    this.personCtx = null;
  }

  private startLoop(): void {
    if (this.rafId !== 0) return;
    this.rafId = requestAnimationFrame(this.frame);
  }

  private stopLoop(): void {
    if (this.rafId !== 0) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  private frame = (): void => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.frame);
    const video = this.inputVideo;
    if (!video || video.readyState < 2) return;
    if (this.mode === 'none' || !this.segmenter || !this.segCanvas || !this.captureTrack) return;

    if (video.videoWidth > 0 && this.compositeCanvas?.width !== video.videoWidth) {
      this.canvasSizeFromVideo();
    }

    const seg = this.segCanvas.getContext('2d');
    if (!seg) return;
    try {
      seg.drawImage(video, 0, 0, SEGMENT_WIDTH, SEGMENT_HEIGHT);
    } catch {
      return;
    }
    try {
      // Callback-вариант: маски живут только внутри колбэка — никаких копий,
      // что и требуется high-throughput режиму (см. .d.ts сегментера).
      this.segmenter.segmentForVideo(this.segCanvas, performance.now(), (result) => {
        this.compositeFrame(result);
        result.close();
      });
    } catch {
      // Единичный сбой кадра не валит луп.
    }
  };

  private compositeFrame(result: ImageSegmenterResult): void {
    const mask = result.confidenceMasks?.[this.labelIndex];
    const video = this.inputVideo;
    const ctx = this.compositeCtx;
    const person = this.personCtx;
    const maskData = this.maskImageData;
    const maskCanvas = this.maskCanvas;
    const composite = this.compositeCanvas;
    const track = this.captureTrack;
    if (!mask || !video || !ctx || !person || !maskData || !maskCanvas || !composite || !track) return;
    if (track.readyState !== 'live') return;

    // 1. Маска фона → альфа человека (SEGMENT sizes, CPU-цикл по 57 КБ).
    const bg = mask.getAsFloat32Array();
    fillPersonAlpha(maskData.data, bg, SEGMENT_WIDTH * SEGMENT_HEIGHT);
    maskCanvas.getContext('2d')!.putImageData(maskData, 0, 0);

    // 2. Силуэт человека: резкий кадр, обрезанный маской (destination-in).
    const frameW = composite.width;
    const frameH = composite.height;
    person.clearRect(0, 0, frameW, frameH);
    person.drawImage(video, 0, 0, frameW, frameH);
    person.globalCompositeOperation = 'destination-in';
    person.drawImage(maskCanvas, 0, 0, frameW, frameH);
    person.globalCompositeOperation = 'source-over';

    // 3. Фон: blur-кадр или картинка cover-fit; без готового фона — резкий кадр.
    ctx.clearRect(0, 0, frameW, frameH);
    if (this.mode === 'blur') {
      ctx.filter = `blur(${BLUR_RADIUS}px)`;
      try {
        ctx.drawImage(video, 0, 0, frameW, frameH);
      } finally {
        ctx.filter = 'none';
      }
    } else if (this.mode === 'image') {
      const img = this.backgroundUrl ? this.bgCache.get(this.backgroundUrl) : undefined;
      const ready = img !== undefined && img.complete && img.naturalWidth > 0;
      if (ready) {
        const fit = coverFit(img.naturalWidth, img.naturalHeight, frameW, frameH);
        if (fit) ctx.drawImage(img, fit.x, fit.y, fit.w, fit.h);
      } else {
        ctx.drawImage(video, 0, 0, frameW, frameH);
      }
    }

    // 4. Человек поверх фона.
    ctx.drawImage(person, 0, 0);

    // 5. Отдаём кадр pull-режиму captureStream(0).
    track.requestFrame();
  }

  private async ensureBackground(url: string): Promise<void> {
    if (this.bgCache.has(url)) return;
    const img = new Image();
    img.decoding = 'async';
    const loaded = await new Promise<HTMLImageElement>((resolve) => {
      img.onload = () => resolve(img);
      img.onerror = () => resolve(img); // naturalWidth=0 → фолбэк на резкий кадр
      img.src = url;
    });
    if (!this.disposed) this.bgCache.set(url, loaded);
  }

  dispose(): void {
    this.disposed = true;
    this.stopLoop();
    this.teardownPipeline();
    this.bgCache.clear();
    this.segmenter?.close();
    this.segmenter = null;
    if (this.inputVideo) {
      this.inputVideo.srcObject = null;
      this.inputVideo = null;
    }
    this.inputStream = null;
    this.setStatus('idle');
  }
}
```

- [ ] **Step 2: Типчек**

```bash
npx tsc --noEmit
```

Expected: 0 байт вывода. Если `noUnusedLocals` ругнётся на что-то — поправить по тексту ошибки (лёрнер: лишний импорт не оставлять).

- [ ] **Step 3: Прогнать прежние юнит-тесты (помощники живы)**

`npx vitest run src/services/__tests__/videoBackground.test.ts`
Expected: PASS (движок не имеет юнитов; ГПУ-путь проверяется ручной проверкой и мок-тестами хука в Task 7).

- [ ] **Step 4: Коммит**

```bash
git add src/services/videoBackground.ts && git commit -m "VYC-100 Движок эффекта фона (сегментация + композит + captureStream)"
```

---

### Task 7: Хук useVideoEffects

**Files:**
- Create: `client/src/hooks/useVideoEffects.ts`
- Create: `client/src/hooks/__tests__/useVideoEffects.test.tsx`

**Interfaces:**
- Consumes: `VideoBackgroundEngine` + `VISION_ASSETS_BASE` + типы (Task 6), `useBackgroundStore.urlById` (Task 3).
- Produces: `useVideoEffects(input: MediaStream | null, mode: BackgroundMode, backgroundImageId: string | null, onTrack: (track: MediaStreamTrack | null) => void): { output: MediaStream | null; status: VideoBackgroundStatus }`.

Семантика:
- `mode='none'` или `input=null` → `onTrack(null)` (служба вернёт исходный камерный трек), `output` = `input`.
- Иначе → грузим модель, строим конвейер, `onTrack(outputTrack)`; `output` = канвас-стрим + аудио-треки input.
- Следит за `addtrack`/`removetrack` видео на input (ре-аквайр камеры в групповых звонках меняет трек внутри того же стрима!) — перезапускает конвейер.
- На unmount: `onTrack(null)` ПЕРВЫМ (служба откатывает трек), затем `engine.dispose()`.

- [ ] **Step 1: Мок-тесты хука**

Создать `client/src/hooks/__tests__/useVideoEffects.test.tsx` (мок движка через `vi.hoisted` — обязательный для ESM-vitest паттерн):

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useVideoEffects } from '@/hooks/useVideoEffects';
import { useBackgroundStore } from '@/stores/backgroundStore';

class MockEngine {
  onStatusChange: ((s: string) => void) | null = null;
  hasEffect = false;
  outputTrack: MediaStreamTrack | null = null;
  status = 'idle';
  setInput = vi.fn(async () => undefined);
  setMode = vi.fn(async () => undefined);
  dispose = vi.fn();
}

const { VideoBackgroundEngine: MockEngineCtor } = vi.hoisted(() => ({
  VideoBackgroundEngine: vi.fn<() => MockEngine>(),
}));

vi.mock('@/services/videoBackground', () => ({
  VideoBackgroundEngine: MockEngineCtor,
  VISION_ASSETS_BASE: '/vision/',
}));

function makeStream(): MediaStream {
  const track = { kind: 'video', readyState: 'live' } as unknown as MediaStreamTrack;
  const stream = new MediaStream();
  stream.addTrack(track);
  return stream;
}

function currentEngine(): MockEngine {
  return MockEngineCtor.mock.results[MockEngineCtor.mock.results.length - 1].value;
}

beforeEach(() => {
  useBackgroundStore.setState({ list: null, listStatus: 'idle', mode: 'none', backgroundId: null });
  MockEngineCtor.mockClear();
});

describe('useVideoEffects: режим none', () => {
  it('не трогает движок и зовёт onTrack(null)', () => {
    const input = makeStream();
    const onTrack = vi.fn();
    const { result } = renderHook(() => useVideoEffects(input, 'none', null, onTrack));

    expect(result.current.output).toBe(input);
    expect(onTrack).toHaveBeenCalledWith(null);
    expect(currentEngine().setInput).not.toHaveBeenCalled();
  });
});

describe('useVideoEffects: эффект активен', () => {
  it('строит конвейер и отдаёт канвас-трек', async () => {
    const input = makeStream();
    const onTrack = vi.fn();
    const fakeTrack = { kind: 'video', readyState: 'live' } as unknown as MediaStreamTrack;

    renderHook(() => useVideoEffects(input, 'blur', null, onTrack));
    const eng = currentEngine();

    expect(eng.setInput).toHaveBeenCalledWith(input);
    await waitFor(() => expect(eng.setMode).toHaveBeenCalledWith('blur', null));

    act(() => {
      eng.hasEffect = true;
      eng.outputTrack = fakeTrack;
      // хук подхватывает готовность движка по статусу
      eng.onStatusChange?.('ready');
    });
    await waitFor(() => expect(onTrack).toHaveBeenCalledWith(fakeTrack));
  });

  it('переключение на none откатывает трек', async () => {
    const input = makeStream();
    const onTrack = vi.fn();
    const { rerender } = renderHook(
      ({ mode }: { mode: 'none' | 'blur' }) => useVideoEffects(input, mode, null, onTrack),
      { initialProps: { mode: 'blur' } },
    );
    rerender({ mode: 'none' });
    expect(onTrack).toHaveBeenLastCalledWith(null);
  });
});

describe('useVideoEffects: cleanup', () => {
  it('возвращает трек и диспоузит движок при размонтировании', () => {
    const input = makeStream();
    const onTrack = vi.fn();
    const { unmount } = renderHook(() => useVideoEffects(input, 'blur', null, onTrack));
    unmount();

    expect(onTrack).toHaveBeenLastCalledWith(null);
    expect(currentEngine().dispose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Прогнать — ожидаем fail**

В `client/`:

```bash
npx vitest run src/hooks/__tests__/useVideoEffects.test.tsx
```

Expected: FAIL — `@/hooks/useVideoEffects` не существует.

- [ ] **Step 3: Реализовать хук**

Создать `client/src/hooks/useVideoEffects.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  VISION_ASSETS_BASE,
  VideoBackgroundEngine,
  type BackgroundMode,
  type VideoBackgroundStatus,
} from '@/services/videoBackground';
import { useBackgroundStore } from '@/stores/backgroundStore';

export interface UseVideoEffectsResult {
  /** Поток для локального превью: оригинал при mode='none', иначе канвас+аудио. */
  output: MediaStream | null;
  status: VideoBackgroundStatus;
}

/**
 * Применяет эффект фона к входному видеопотоку.
 *
 * - mode='none' или input=null → движок простаивает, onTrack(null) откатывает
 *   подмену в звонке, output === input.
 * - иначе → грузит модель, строит канвас-конвейер и сообщает трек через
 *   onTrack (мы пушим его в звонок через setCameraOutput).
 * - следит за заменой видео-трека внутри input (ре-аквайр камеры в групповом
 *   звонке меняет трек без смены стрима) — перезапускает конвейер.
 * - при размонтировании сначала откатывает трек, потом dispose движка.
 */
export function useVideoEffects(
  input: MediaStream | null,
  mode: BackgroundMode,
  backgroundImageId: string | null,
  onTrack: (track: MediaStreamTrack | null) => void,
): UseVideoEffectsResult {
  const urlById = useBackgroundStore((s) => s.urlById);
  const [status, setStatus] = useState<VideoBackgroundStatus>('idle');
  const onTrackRef = useRef(onTrack);
  onTrackRef.current = onTrack;

  const engineRef = useRef<VideoBackgroundEngine | null>(null);
  if (engineRef.current === null) {
    engineRef.current = new VideoBackgroundEngine({ assetsBase: VISION_ASSETS_BASE });
    engineRef.current.onStatusChange = setStatus;
  }

  const backgroundUrl = mode === 'image' && backgroundImageId
    ? urlById(backgroundImageId)
    : null;

  const apply = useCallback(async (): Promise<void> => {
    const engine = engineRef.current!;
    if (mode === 'none' || !input) {
      engine.setMode('none', null).catch(() => {});
      onTrackRef.current(null);
      return;
    }
    try {
      await engine.setInput(input);
      await engine.setMode(mode, backgroundUrl);
      // Модель могла не загрузиться (status 'error') — тогда трек не меняем:
      // в эфир уходит оригинальная камера.
      const track = engine.outputTrack;
      onTrackRef.current(track);
    } catch {
      onTrackRef.current(null);
    }
  }, [input, mode, backgroundUrl]);

  useEffect(() => {
    void apply();
  }, [apply]);

  // Замена видео-трека внутри того же стрима (ре-аквайр VYC-96 и смена
  // устройства) — движок должен перестроиться на новом треке.
  useEffect(() => {
    if (!input) return;
    const onChange = (e: Event): void => {
      if ((e as MediaStreamTrackEvent).track.kind !== 'video') return;
      void apply();
    };
    input.addEventListener('addtrack', onChange);
    input.addEventListener('removetrack', onChange);
    return () => {
      input.removeEventListener('addtrack', onChange);
      input.removeEventListener('removetrack', onChange);
    };
  }, [input, apply]);

  // Размонтирование: откат трека строго до dispose — служба должна успеть
  // вернуть оригинальный камерный трек на сендер.
  useEffect(() => {
    const engine = engineRef.current!;
    return () => {
      onTrackRef.current(null);
      engine.dispose();
    };
  }, []);

  const output = mode === 'none' || !input ? input : (engineRef.current!.outputTrack ? buildOutput(input, engineRef.current!.outputTrack) : input);

  return { output, status: mode === 'none' ? 'idle' : status };
}

function buildOutput(input: MediaStream, videoTrack: MediaStreamTrack): MediaStream {
  const out = new MediaStream([videoTrack]);
  for (const t of input.getAudioTracks()) out.addTrack(t);
  return out;
}
```

Примечание по типу: `engine.outputTrack` — `MediaStreamTrack | null`; в `buildOutput` передаётся не-null после проверки `? :` — TS сузит через тернарник только при буквальной проверке `engineRef.current!.outputTrack !== null`. Чтобы не спотыкаться о типы, перепишите тернарник в функцию:

```ts
  const track = engineRef.current!.outputTrack;
  const output = mode === 'none' || !input ? input : track ? buildOutput(input, track) : input;
```

(Используйте этот вариант — он типобезопасен.)

- [ ] **Step 4: Прогнать тесты**

```bash
npx vitest run src/hooks/__tests__/useVideoEffects.test.tsx
```

Expected: PASS. Если тест «строит конвейер» не дожидается трека — проверьте, что хук вызывает `onTrack` после `engine.outputTrack` в том же микрозадаче, что и `setMode` (он это делает); `waitFor` покроет.

- [ ] **Step 5: Типчек + коммит**

```bash
npx tsc --noEmit && npx vitest run src/hooks/__tests__ src/services/__tests__/videoBackground.test.ts src/stores/__tests__/backgroundStore.test.ts && git add src/hooks/useVideoEffects.ts src/hooks/__tests__/useVideoEffects.test.tsx && git commit -m "VYC-100 Хук useVideoEffects"
```

---

### Task 8: Подмена трека в call.ts и groupCall.ts

**Files:**
- Modify: `client/src/services/call.ts`
- Modify: `client/src/services/groupCall.ts`

**Interfaces:**
- Consumes: ничего нового от других тасок — публичный метод зовётся хуком (Task 7).
- Produces:
  - `callService.setCameraOutput(track: MediaStreamTrack | null): Promise<void>`
  - `groupCallService.setCameraOutput(track: MediaStreamTrack | null): Promise<void>`
  - Семантика: `null` → вернуть исходный камерный трек; если трек не менялся — no-op; ошибки replaceTrack проглатываются (оставляем как было).

#### call.ts

- [ ] **Step 1: Поле cameraTrack**

В `client/src/services/call.ts`, рядом с полем `private localStream: MediaStream | null = null;` (строка ~64 области объявлений — фактически выше, найдите `private localStream` в классе) добавить:

```ts
  /** Исходный камерный трек — целевой для setCameraOutput(null). */
  private cameraTrack: MediaStreamTrack | null = null;
```

В `startCall` сразу после `this.localStream = await noiseCancellationService.createChain(rawStream);` (строка 61) — и в `acceptCall` после той же строки (строка 131):

```ts
          this.cameraTrack = this.localStream.getVideoTracks()[0] ?? null;
```

(t.е. в обеих ветках, где создаётся NC-цепочка; в ветке `else { this.localStream = null; }` не нужно.)

В `cleanup()` после `this.localStream = null;` (строка 311):

```ts
    this.cameraTrack = null;
```

- [ ] **Step 2: Метод setCameraOutput**

В `client/src/services/call.ts`, после `toggleMuteVideo` (строка 206):

```ts
  /**
   * Подменяет видео-трек, уходящий собеседнику (VYC-100): replaceTrack на
   * видео-сендере + removeTrack/addTrack в localStream, чтобы превью и
   * остальная логика (мьют, статистика) всегда видели актуальный трек.
   * null — вернуть исходный камерный трек. Аудио не трогается никогда.
   */
  async setCameraOutput(track: MediaStreamTrack | null): Promise<void> {
    const target = track ?? this.cameraTrack;
    if (!this.localStream || !target) return;
    const current = this.localStream.getVideoTracks()[0];
    if (current === target) return;

    const sender = this.peerConnection?.getSenders().find((s) => s.track?.kind === 'video') ?? null;
    try {
      if (sender) await sender.replaceTrack(target);
    } catch {
      return; // подмена не удалась — оставляем как было
    }
    if (current) this.localStream.removeTrack(current);
    target.enabled = current ? current.enabled : true;
    this.localStream.addTrack(target);
  }
```

#### groupCall.ts

- [ ] **Step 3: Поле cameraTrack**

В `client/src/services/groupCall.ts`, вместе с полем `private localStream: MediaStream | null = null;` (строка ~222), добавить:

```ts
  /** Исходный камерный трек — целевой для setCameraOutput(null). */
  private cameraTrack: MediaStreamTrack | null = null;
```

- [ ] **Step 4: Метод setCameraOutput**

После `toggleMuteVideo` (строка 1193):

```ts
  /**
   * Подменяет камерный видео-трек на эффект-трек (VYC-100): replaceTrack на
   * сендере камеры + removeTrack/addTrack в localStream — превью, мьют,
   * placeholder и статистика видят актуальный трек. null — вернуть исходный
   * камерный трек. Аудио не трогается никогда.
   */
  async setCameraOutput(track: MediaStreamTrack | null): Promise<void> {
    const stream = this.localStream;
    const current = stream?.getVideoTracks()[0] ?? null;
    if (!stream || !current) return;
    if (this.cameraTrack === null) this.cameraTrack = current;
    const target = track ?? this.cameraTrack;
    if (target === current) return;

    const sender = this.pc?.getSenders().find((s) => s.track === current) ?? null;
    try {
      if (sender) await sender.replaceTrack(target);
    } catch {
      return;
    }
    stream.removeTrack(current);
    target.enabled = current.enabled;
    stream.addTrack(target);
    gcLog(this.currentUserId, 'camera output swapped', { effect: track !== null });
  }
```

- [ ] **Step 5: Обновлять cameraTrack при ре-аквайре камеры**

В `reacquireCameraAfterBackground` (строки 1366-1369), после `cur.removeTrack(old); cur.addTrack(track);` — точный блок:

```ts
    if (track !== old) {
      cur.removeTrack(old);
      cur.addTrack(track);
    }
```

Заменить на:

```ts
    if (track !== old) {
      cur.removeTrack(old);
      cur.addTrack(track);
      // Свежий трек — новый «исходный» для setCameraOutput(null): старый
      // уже остановлен, откат на него отдал бы чёрный кадр.
      if (this.cameraTrack === old) this.cameraTrack = track;
    }
```

- [ ] **Step 6: Сброс при завершении группового звонка**

Найти в `groupCall.ts` место расставания с localStream (поиск `this.localStream = null;`) в методов полного завершения сессии (leaveGroupCall/демонтаж — там же, где чистится screenStream и пр.) и добавить рядом:

```ts
    this.cameraTrack = null;
```

- [ ] **Step 7: Проверки**

```bash
npx tsc --noEmit
```

Expected: в групповом файле может всплыть `gcLog`-сигнатура — используйте её так же, как соседние вызовы (первый аргумент `this.currentUserId`). Если в вашей копии `gcLog` недоступен на этом месте — удалите строку с `gcLog` из метода.

```bash
npm test 2>&1 | tail -20
```

Expected: ровно 3 фикстуры-фейла в `api.network-retry.test.ts`, новых нет.

- [ ] **Step 8: Коммит**

```bash
git add src/services/call.ts src/services/groupCall.ts && git commit -m "VYC-100 Подмена камерного трека в P2P и групповых звонках"
```

---

### Task 9: Настройки — секция «Фон звонка» + живое превью

**Files:**
- Create: `client/src/components/settings/BackgroundSettings.tsx`
- Create: `client/src/components/settings/BackgroundSettings.css`
- Modify: `client/src/components/settings/VideoSettings.tsx`
- Modify: `client/src/i18n/locales/ru.ts`, `client/src/i18n/locales/en.ts`

**Interfaces:**
- Consumes: `useBackgroundStore` (Task 3), `useVideoEffects` (Task 7).
- Produces: экспорт `BackgroundSettings` — рендерится внутри секции «Видео» настроек.

- [ ] **Step 1: i18n ключи (сначала — чтобы UI их уже ссылался)**

В `client/src/i18n/locales/ru.ts`:
- В конец блока `call:` (после `bannerGoToCall: 'К звонку',`, строка 277):

```ts
    // VYC-100: панель фона в звонке
    bgMenu: 'Фон звонка',
    bgModeNone: 'Оригинал',
    bgModeBlur: 'Размытие',
    bgModeImage: 'Картинка',
    bgUnavailable: 'Список фонов недоступен',
```

- В конец блока `settings:` (после последней строки секции — найдите `allowSearchByPhoneDescription` или любую хвостовую строку `settings`, прямо перед закрывающей `},`):

```ts
    // VYC-100: фон звонка
    backgroundTitle: 'Фон звонка',
    backgroundDescription: 'Размытие или замена фона во время звонков',
    bgModeNone: 'Оригинал',
    bgModeBlur: 'Размытие',
    bgModeImage: 'Картинка',
    backgroundUnavailable: 'Список фонов недоступен',
    backgroundEffectUnavailable: 'Эффект фона недоступен на этом устройстве',
```

> Якорь для вставки в settings: ключи секции идут внутри `settings: { ... }`; вставьте перед закрывающей скобкой объекта. Убедиться, что НЕ внутри вложенного объекта (вроде `privacy:`).

В `client/src/i18n/locales/en.ts` — те же ключи (анкеры: `bannerGoToCall: 'To call',` строка 266; хвост `settings`; параллельно закрытию объекта):

```ts
    // VYC-100
    bgMenu: 'Call background',
    bgModeNone: 'Original',
    bgModeBlur: 'Blur',
    bgModeImage: 'Image',
    bgUnavailable: 'Background list unavailable',
```

и

```ts
    backgroundTitle: 'Call background',
    backgroundDescription: 'Blur or replace your background during calls',
    bgModeNone: 'Original',
    bgModeBlur: 'Blur',
    bgModeImage: 'Image',
    backgroundUnavailable: 'Background list unavailable',
    backgroundEffectUnavailable: 'Background effect unavailable on this device',
```

- [ ] **Step 2: Проверить паритет**

```bash
npm run check:i18n
```

Expected: `непереведённых строк не найдено.` (старые ключи тоже должны сойтись — если ругнётся на нашей паре, значит анкеры/дубли разошлись — поправить по выводу).

- [ ] **Step 3: Компонент фона**

Создать `client/src/components/settings/BackgroundSettings.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { useT } from '@/i18n';
import { useBackgroundStore, BACKGROUND_MODES, type BackgroundMode } from '@/stores/backgroundStore';
import { useVideoEffects } from '@/hooks/useVideoEffects';
import './BackgroundSettings.css';

/** Живое превью: камера + текущий эффект. Раздельный компонент, чтобы
 *  стрим жил ровно столько, сколько видна секция. val: превью не подменяет
 *  треки — onTrack no-op. */
function BackgroundPreview() {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [camera, setCamera] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState(false);
  const mode = useBackgroundStore((s) => s.mode);
  const backgroundId = useBackgroundStore((s) => s.backgroundId);

  useEffect(() => {
    let cancelled = false;
    let owned: MediaStream | null = null;
    void navigator.mediaDevices
      ?.getUserMedia({ video: true })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        owned = stream;
        setCamera(stream);
      })
      .catch(() => {
        if (!cancelled) setCameraError(true);
      });
    return () => {
      cancelled = true;
      owned?.getTracks().forEach((tr) => tr.stop());
    };
  }, []);

  const { output } = useVideoEffects(camera, mode, backgroundId, () => {});

  useEffect(() => {
    if (videoRef.current && output) {
      videoRef.current.srcObject = output;
    }
  }, [output]);

  return (
    <div className="background-preview">
      {cameraError && <div className="background-preview-empty">{t('settings.backgroundEffectUnavailable')}</div>}
      {!cameraError && (
        <video ref={videoRef} autoPlay playsInline muted className="background-preview-video" />
      )}
    </div>
  );
}

function ModeSwitch() {
  const t = useT();
  const mode = useBackgroundStore((s) => s.mode);
  const setMode = useBackgroundStore((s) => s.setMode);

  return (
    <div className="background-modes" role="group" aria-label={t('settings.backgroundTitle')}>
      {BACKGROUND_MODES.map((m) => (
        <button
          key={m}
          type="button"
          className={`background-mode-btn${mode === m ? ' is-active' : ''}`}
          onClick={() => setMode(m)}
        >
          {t(`settings.bgMode${m[0].toUpperCase()}${m.slice(1)}` as never)}
        </button>
      ))}
    </div>
  );
}
```

⛔ Стоп: `t`-ключи с шаблоном — плохой паттерн для этого репо (i18n-хеш и статический грид). НЕ используйте шаблонный ключ. Пишем явно:

```tsx
function ModeSwitch() {
  const t = useT();
  const mode = useBackgroundStore((s) => s.mode);
  const setMode = useBackgroundStore((s) => s.setMode);
  const labels: Record<BackgroundMode, string> = {
    none: t('settings.bgModeNone'),
    blur: t('settings.bgModeBlur'),
    image: t('settings.bgModeImage'),
  };

  return (
    <div className="background-modes" role="group" aria-label={t('settings.backgroundTitle')}>
      {BACKGROUND_MODES.map((m) => (
        <button
          key={m}
          type="button"
          className={`background-mode-btn${mode === m ? ' is-active' : ''}`}
          onClick={() => setMode(m)}
        >
          {labels[m]}
        </button>
      ))}
    </div>
  );
}
```

Продолжение файла (галерея):

```tsx
function BackgroundGallery() {
  const t = useT();
  const mode = useBackgroundStore((s) => s.mode);
  const backgroundId = useBackgroundStore((s) => s.backgroundId);
  const setBackground = useBackgroundStore((s) => s.setBackground);
  const list = useBackgroundStore((s) => s.list);
  const listStatus = useBackgroundStore((s) => s.listStatus);
  const fetchBackgrounds = useBackgroundStore((s) => s.fetchBackgrounds);

  useEffect(() => {
    void fetchBackgrounds();
  }, [fetchBackgrounds]);

  if (mode !== 'image') return null;
  if (listStatus === 'error') {
    return <p className="background-unavailable">{t('settings.backgroundUnavailable')}</p>;
  }
  if (list === null || list.length === 0) {
    return <p className="background-unavailable">{t('settings.backgroundUnavailable')}</p>;
  }

  return (
    <div className="background-grid">
      {list.map((bg) => (
        <button
          key={bg.id}
          type="button"
          className={`background-cell${backgroundId === bg.id ? ' is-active' : ''}`}
          onClick={() => setBackground(bg.id)}
          title={bg.name}
        >
          <img src={bg.url} alt={bg.name} loading="lazy" />
        </button>
      ))}
    </div>
  );
}

export function BackgroundSettings() {
  const t = useT();

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">{t('settings.backgroundTitle')}</h3>

      <div className="setting-row">
        <div className="setting-row-info">
          <span className="setting-row-title">{t('settings.backgroundTitle')}</span>
          <p className="setting-row-desc">{t('settings.backgroundDescription')}</p>
        </div>
        <ModeSwitch />
      </div>

      <BackgroundGallery />
      <BackgroundPreview />
    </div>
  );
}
```

- [ ] **Step 4: CSS**

Создать `client/src/components/settings/BackgroundSettings.css` (токены — только канонические: дизайн-система закрыта, документ `client/docs/design-system.md`):

```css
.background-preview {
  margin-top: var(--sp-4);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: var(--canvas-3);
  aspect-ratio: 16 / 9;
  display: flex;
  align-items: center;
  justify-content: center;
}

.background-preview-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.background-preview-empty {
  color: var(--muted);
  font-size: 13px;
  padding: var(--sp-4);
}

.background-modes {
  display: inline-flex;
  gap: var(--sp-2);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  padding: 2px;
}

.background-mode-btn {
  border: none;
  background: transparent;
  color: var(--muted);
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--radius-sm);
  font-size: 13px;
  cursor: pointer;
}

.background-mode-btn:hover {
  color: var(--ink);
}

.background-mode-btn.is-active {
  background: var(--accent);
  color: var(--canvas);
}

.background-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: var(--sp-2);
  margin-top: var(--sp-3);
}

.background-cell {
  position: relative;
  border: 2px solid transparent;
  border-radius: var(--radius-md);
  overflow: hidden;
  padding: 0;
  background: var(--canvas-3);
  cursor: pointer;
  aspect-ratio: 16 / 9;
}

.background-cell img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.background-cell.is-active {
  border-color: var(--accent);
}

.background-unavailable {
  color: var(--muted);
  font-size: 13px;
  margin-top: var(--sp-3);
}
```

⛔ ВАЖНО: токены `--sp-2`, `--radius-lg`, `--canvas-3` могут называться в вашей копии иначе (переменные в `client/src/styles/tokens.css`). Перед коммитом сверьте каждое имя с токен-файлом и поправьте на фактическое; самодельные значения запрещены (stylelint-гейт и дизайн-система). stylelint при этом не должен выдавать ни байта.

- [ ] **Step 5: Подключить в VideoSettings**

В `client/src/components/settings/VideoSettings.tsx` после закрытия первого `</div>` с `setting-row` (перед завершающим `</div>` и `);`):

```tsx
      <BackgroundSettings />
```

и в импорты:

```tsx
import { BackgroundSettings } from '@/components/settings/BackgroundSettings';
```

- [ ] **Step 6: Гейты**

```bash
npx tsc --noEmit && npx stylelint "src/**/*.css" && npm run check:i18n && npm test 2>&1 | tail -5
```

Expected: tsc 0 байт; stylelint 0 байт; i18n чисто; тесты — ровно 3 известных фейла.

- [ ] **Step 7: Коммит**

```bash
git add src/components/settings/BackgroundSettings.tsx src/components/settings/BackgroundSettings.css src/components/settings/VideoSettings.tsx src/i18n/locales/ru.ts src/i18n/locales/en.ts && git commit -m "VYC-100 Настройки: секция фона звонка с живым превью"
```

---

### Task 10: Быстрая панель в звонке (CallUI + CallStage)

**Files:**
- Create: `client/src/components/call/BackgroundPicker.tsx`
- Create: `client/src/components/call/BackgroundPicker.css`
- Modify: `client/src/components/CallUI.tsx`
- Modify: `client/src/components/CallStage.tsx`

**Interfaces:**
- Consumes: `useBackgroundStore` (Task 3), `useVideoEffects` (Task 7), `callService.setCameraOutput` / `groupCallService.setCameraOutput` (Task 8), `useDismissOnOutside` (`client/src/hooks/useDismissOnOutside`), портал + рект-позиционирование как у `GuestInvitePopover`.
- Produces: `BackgroundPicker({ anchorRef, onClose })` — портал-поповер, монтируется только пока открыт.

- [ ] **Step 1: Компонент-поповер**

Создать `client/src/components/call/BackgroundPicker.tsx`:

```tsx
import { useEffect, useMemo, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '@/i18n';
import { useDismissOnOutside } from '@/hooks/useDismissOnOutside';
import { useBackgroundStore, BACKGROUND_MODES, type BackgroundMode } from '@/stores/backgroundStore';
import './BackgroundPicker.css';

interface BackgroundPickerProps {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}

/**
 * Быстрая панель эффекта фона во время звонка. Монтируется только пока
 * открыта — контракт useDismissOnOutside (client/docs/design-system.md,
 * «Overlays»). Позиционируется от кнопки-якоря ректом.
 */
export function BackgroundPicker({ anchorRef, onClose }: BackgroundPickerProps) {
  const t = useT();
  const containerRef = useDismissOnOutside<HTMLDivElement>(onClose);
  const mode = useBackgroundStore((s) => s.mode);
  const setMode = useBackgroundStore((s) => s.setMode);
  const backgroundId = useBackgroundStore((s) => s.backgroundId);
  const setBackground = useBackgroundStore((s) => s.setBackground);
  const list = useBackgroundStore((s) => s.list);
  const listStatus = useBackgroundStore((s) => s.listStatus);
  const fetchBackgrounds = useBackgroundStore((s) => s.fetchBackgrounds);

  const [position, setPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPosition({ top: rect.bottom + 8, left: rect.left });
    void fetchBackgrounds();
  }, [anchorRef, fetchBackgrounds]);

  const labels: Record<BackgroundMode, string> = useMemo(() => ({
    none: t('call.bgModeNone'),
    blur: t('call.bgModeBlur'),
    image: t('call.bgModeImage'),
  }), [t]);

  return createPortal(
    <div
      className="background-picker"
      ref={containerRef}
      style={{ top: position.top, left: position.left }}
    >
      <div className="background-picker-head">{t('call.bgMenu')}</div>
      <div className="background-picker-modes" role="group" aria-label={t('call.bgMenu')}>
        {BACKGROUND_MODES.map((m) => (
          <button
            key={m}
            type="button"
            className={`background-picker-mode${mode === m ? ' is-active' : ''}`}
            onClick={() => setMode(m)}
          >
            {labels[m]}
          </button>
        ))}
      </div>
      {mode === 'image' && (
        <div className="background-picker-strip">
          {listStatus === 'error' || list === null || list.length === 0 ? (
            <span className="background-picker-note">{t('call.bgUnavailable')}</span>
          ) : (
            list.map((bg) => (
              <button
                key={bg.id}
                type="button"
                className={`background-picker-thumb${backgroundId === bg.id ? ' is-active' : ''}`}
                onClick={() => setBackground(bg.id)}
                title={bg.name}
              >
                <img src={bg.url} alt={bg.name} loading="lazy" />
              </button>
            ))
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}
```

- [ ] **Step 2: CSS**

Создать `client/src/components/call/BackgroundPicker.css` (токены — из `client/src/styles/tokens.css`; сверьте имена, см. предупреждение в Task 9):

```css
.background-picker {
  position: fixed;
  z-index: var(--z-popover);
  width: 280px;
  background: var(--panel);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-popover);
  padding: var(--sp-3);
}

.background-picker-head {
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: var(--sp-2);
}

.background-picker-modes {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--sp-1);
}

.background-picker-mode {
  border: 1px solid var(--line);
  background: var(--canvas);
  color: var(--ink);
  font-size: 12px;
  padding: var(--sp-2) 0;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.background-picker-mode.is-active {
  border-color: var(--accent);
  color: var(--accent-text);
  background: var(--accent-soft);
}

.background-picker-strip {
  display: flex;
  gap: var(--sp-2);
  margin-top: var(--sp-3);
  overflow-x: auto;
  padding-bottom: 2px;
}

.background-picker-thumb {
  flex: 0 0 88px;
  aspect-ratio: 16 / 9;
  border: 2px solid transparent;
  border-radius: var(--radius-sm);
  overflow: hidden;
  padding: 0;
  background: var(--canvas-3);
  cursor: pointer;
}

.background-picker-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.background-picker-thumb.is-active {
  border-color: var(--accent);
}

.background-picker-note {
  color: var(--muted);
  font-size: 12px;
}
```

- [ ] **Step 3: Интеграция в CallUI**

В `client/src/components/CallUI.tsx`:

Импорты (добавить к существующим):

```tsx
import { Layers } from 'lucide-react';
import { BackgroundPicker } from '@/components/call/BackgroundPicker';
import { useBackgroundStore } from '@/stores/backgroundStore';
import { useVideoEffects } from '@/hooks/useVideoEffects';
```

Состояние (после `const localVideoRef = useRef<HTMLVideoElement>(null);`, строка 32):

```tsx
  const [bgPickerOpen, setBgPickerOpen] = useState(false);
  const bgBtnRef = useRef<HTMLButtonElement>(null);
  const bgMode = useBackgroundStore((s) => s.mode);
  const bgId = useBackgroundStore((s) => s.backgroundId);
```

Хук эффекта (после `useEffect` для remoteStream-а, строка 136 — ДО раннего `return null` на строке 157; хуки не должны обходить ранний возврат):

```tsx
  useVideoEffects(
    activeCall ? callService.localStreamState : null,
    bgMode,
    bgId,
    useCallback((track) => {
      void callService.setCameraOutput(track);
    }, []),
  );
```

Кнопка в панели управления — в `.p2p-controls`, после блока камеры (после `</div>` блока `.p2p-ctl` с камерой, строка ~258) и до `.p2p-ctl-divider`:

```tsx
            <div className="p2p-ctl">
              <button
                ref={bgBtnRef}
                className={`p2p-ctl-btn${bgPickerOpen ? ' is-on' : ''}`}
                onClick={() => setBgPickerOpen((o) => !o)}
                title={t('call.bgMenu')}
              >
                <Layers size={16} strokeWidth={1.8} />
              </button>
              <span className="p2p-ctl-label">{t('call.bgMenu')}</span>
            </div>
```

Поповер — в конце JSX активного звонка, после блока `.p2p-controls` (после `</div>` на строке 264):

```tsx
          {bgPickerOpen && (
            <BackgroundPicker anchorRef={bgBtnRef} onClose={() => setBgPickerOpen(false)} />
          )}
```

- [ ] **Step 4: Интеграция в CallStage**

В `client/src/components/CallStage.tsx`:

Импорты:

```tsx
import { Layers } from 'lucide-react';
import { BackgroundPicker } from './call/BackgroundPicker';
import { groupCallService } from '@/services/groupCall';
import { useBackgroundStore } from '@/stores/backgroundStore';
import { useVideoEffects } from '@/hooks/useVideoEffects';
```

Состояние + хук (после `const t = useT();`-блока в начале компонента, ДО раннего `if (!m.isInGroupCall) return null;`):

```tsx
  const [bgPickerOpen, setBgPickerOpen] = useState(false);
  const bgBtnRef = useRef<HTMLButtonElement>(null);
  const bgMode = useBackgroundStore((s) => s.mode);
  const bgId = useBackgroundStore((s) => s.backgroundId);

  useVideoEffects(
    m.isInGroupCall ? groupCallService.localStreamState : null,
    bgMode,
    bgId,
    useCallback((track) => {
      void groupCallService.setCameraOutput(track);
    }, []),
  );
```

(импорт `useState, useRef, useCallback` — уже есть в React-импорте? В CallStage.tsx на первой строке `import { createPortal } from 'react-dom';` — а React-хуков нет! Проверьте: компонент не использует локальные хуки. Добавьте импорт:

```tsx
import { useCallback, useRef, useState } from 'react';
```

Кнопка в `.stage-controls`, после блока камеры (после `</div>` блока `.stage-ctl` с камерой, строка ~335):

```tsx
        <div className="stage-ctl">
          <button
            ref={bgBtnRef}
            className={`stage-ctl-btn${bgPickerOpen ? ' is-on' : ''}`}
            onClick={() => setBgPickerOpen((o) => !o)}
            title={t('call.bgMenu')}
          >
            <Layers size={16} strokeWidth={1.8} />
          </button>
          <span className="stage-ctl-label">{t('call.bgMenu')}</span>
        </div>
```

Поповер — в конце JSX, рядом с `GuestInvitePopover` (после блока `{m.invitePosition ...}`):

```tsx
      {bgPickerOpen && (
        <BackgroundPicker anchorRef={bgBtnRef} onClose={() => setBgPickerOpen(false)} />
      )}
```

- [ ] **Step 5: Гейты**

```bash
npx tsc --noEmit && npx stylelint "src/**/*.css" && npm run check:i18n && npm test 2>&1 | tail -5
```

Expected: все гейты чистые; тесты — ровно 3 известных фейла.

- [ ] **Step 6: Коммит**

```bash
git add src/components/call/BackgroundPicker.tsx src/components/call/BackgroundPicker.css src/components/CallUI.tsx src/components/CallStage.tsx && git commit -m "VYC-100 Быстрая панель фона в P2P и групповых звонках"
```

---

### Task 11: Финальная верификация

**Files:** нет (проверки).

- [ ] **Step 1: Полный прогон клиентских гейтов**

```bash
npx tsc --noEmit && npx stylelint "src/**/*.css" && npm run check:i18n && npm test 2>&1 | tail -30
```

Expected: tsc 0 байт; stylelint 0 байт; i18n чисто; `npm test`: ровно 3 фейла, все в `src/services/__tests__/api.network-retry.test.ts`, ни одного нового.

- [ ] **Step 2: Go-гейты**

Из корня репо:

```bash
make test && make vet && make lint
```

- [ ] **Step 3: Проверить сборку и ассеты**

```bash
npm run build:vite
```

Expected: билд успешен; `ls dist/vision/` содержит `vision_wasm_internal.js`, `vision_wasm_internal.wasm`, `selfie_multiclass_256x256.tflite`.

- [ ] **Step 4: Ручная проверка (обязательно, движок юнитами не покрыт)**

1. `npm run dev:vite`, сервер API с `BACKGROUNDS_DIR` на каталог с парой тестовых картинок (можно создать `server/backgrounds/{ocean.png}` и положить любой PNG 1280×720).
2. Настройки → Видео → «Фон звонка»: превью показывает камеру; «Размытие» — фон размыт, силуэт резкий; «Картинка» — фон подставлен, галерея заполнена; обе темы (светлая/тёмная) — см. client/CLAUDE.md «click through in both themes».
3. P2P-звонок: панель в оверлее, смена режимов на лету, собеседник видит эффект; выключение камеры (мьют видео) при активном эффекте — замёрзший кадр, без крашей; завершение звонка — обычная камера в следующем звонке.
4. Групповой звонок: то же; переключение каналов (сцена размонтируется/монтируется) — эффект восстанавливается по сохранённому выбору.
5. Electron prod-путь: `npm run dist` (или `npm run dev:electron` после `build:vite`) — эффект работает и на `file://` (IPC `visionAssetsUrl`).
6. Без модели (сломать URL, `NODE_ENV=development` с отсутствующим `public/vision`): приложение живёт, в настройках предупреждение, в звонке оригинальное видео.

- [ ] **Step 5: Финальные коммиты правок и итог**

```bash
git status
```

Если ручные проверки выявили правки — закоммитить их отдельным коммитом `VYC-100 Правки по результатам ручной проверки`. Итог: ветка готова к PR.

---

## Self-Review (выполнено при написании)

- **Покрытие спеки:** режимы none/blur/image ✓ (T5-T7); 320×180 сегментация ✓ (T6); captureStream(0)+requestFrame ✓; replaceTrack+localStream-swap в обоих типах звонков ✓ (T8); галерея в настройках + быстрая панель ✓ (T9-T10); Go-эндпоинт список+файл, auth на список ✓ (T1); конфиг ✓; i18n ru/en ✓ (T9); ассеты+asarUnpack+IPC ✓ (T4); error-статус модели → исходный поток ✓ (T6-T7); тесты: store/api/helpers/hook ✓ (T2, T3, T5, T7), Go ✓ (T1); гейты ✓ (T11); риск «blur на большом canvas» — оставлен на ручную проверку T11 step 4.2 (спека допускает фолбэк на 480p-канвас при фризах — зафиксирован в спеке как риск, не в скоупе).
- **Плейсхолдеры:** нет — код полный. Единственные места с «проверьте/сверьте» — намеренные: имена токенов CSS и точные строки вставки зависят от рабочей копии (в плане даны якоря).
- **Типы:** `BackgroundMode`, `VideoBackgroundStatus`, `setCameraOutput(track: MediaStreamTrack | null)`, `useVideoEffects(...)` — единые во всех тасках; `urlById` и `resolveBackgroundUrl` — только в сторе; `outputTrack`/`hasEffect` — только в движке.