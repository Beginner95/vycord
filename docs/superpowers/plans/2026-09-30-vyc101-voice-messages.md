# Голосовые сообщения в чате (VYC-101) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Telegram-подобные голосовые сообщения: удержание микрофона в композере → запись → отпустил → голосовое в ленте; пузырь с волной, перемоткой, скоростью и отметкой «прослушано» на каждого получателя.

**Architecture:** Голосовое — обычное вложение `kind='audio'` с тремя новыми колонками (`is_voice`, `duration_ms`, `waveform`) и таблицей `voice_listens`; загрузка идёт через существующий `POST /api/v1/attachments` с дополнительными полями формы, сообщение — через существующий `POST …/messages`. На клиенте жест — чистая state machine, рекордер — не-React модуль с единой функцией освобождения, отправка — оптимистичная строка с локальным blob и retry.

**Tech Stack:** Go 1.27 (`net/http`, pgx v5, testify), Postgres; React 19 + Zustand 5 + TypeScript + Vitest (+ @testing-library/react в jsdom), MediaRecorder / Web Audio, lucide-react.

**Spec:** `docs/superpowers/specs/2026-09-30-voice-messages-design.md` — читать вместе с планом.

## Global Constraints

- Ветка `VYC-101-audio-in-chat`. Коммиты делает исполнитель, **не пушит**, **никогда не добавляет co-author** (строки `Co-Authored-By` нет).
- **Никогда `git add -A` / `git add .`** — только явные пути. Файлы в `docs/superpowers/` добавлять `git add -f <путь>` (глобальный `~/.gitignore` пользователя их игнорирует).
- Все `npm`/`npx`/`node` — из `client/`. Серверные `make …` — из корня репозитория.
- Миграция — `027_voice_messages` (up + down), формат файлов: первая строка `-- +migrate Up` / `-- +migrate Down`.
- Волна — **ровно 64 байта** (0–255). Длительность — **1000 … 900000 мс**. Пороги жеста: `LOCK_DY = 60` px вверх, `CANCEL_DX = 100` px влево.
- Коды ошибок: `voice_invalid`, `voice_message_invalid` (HTTP 400). WS-событие: `voice_listened` с payload `{channel_id, message_id, attachment_id, user_id}`.
- Запись во время звонка **запрещена** (подсказка). Трек звонка, `call.ts`, `groupCall.ts`, шумодав — не трогать.
- Дизайн: только токены из `client/src/styles/tokens.css`; классы `component-thing` (префиксы `voice-msg-*`, `composer-voice-*`); иконки `lucide-react` с явным `size` и `strokeWidth={1.8}`; нет сырых цветов, нет 12px-радиуса, нет `z-index`-литералов; `var(--x, fallback)` — только для JS-инжектируемых свойств (`--meter-level`, новое `--voice-bar-h`, `--voice-drag-x`).
- i18n: каждая строка в `ru.ts` и `en.ts` в одном коммите.
- Клиентские гейты: `npx tsc --noEmit` → exit 0 и **0 байт**; `npx stylelint "src/**/*.css"` → exit 0 и **0 байт**; `npm run check:i18n` → «непереведённых строк не найдено.»; `npm test` → **ровно 3** падения, все в `api.network-retry.test.ts` (**этот файл не трогать**).
- **Серверная базовая линия (замерена 2026-09-30 на `88e0d46`, go1.27.1):** `make test` — exit 0, все пакеты `ok`; `make vet` — exit 0, пустой вывод; `make lint` — **сломан окружением**: golangci-lint 1.64.6 собран go1.24 и не читает export data go1.27 → 50 ошибок `(typecheck)` вида `could not load export data … version 4 is greater than maximum supported version 2`, exit 2. Это не регрессия. Вместо `make lint` серверный гейт: `make test` + `make vet` + `cd server && gofmt -l ./internal ./cmd ./pkg` (пустой вывод). Если окружение починят (golangci-lint ≥ версии, собранной go1.27) — прогнать `make lint` и сравнить только новые находки в тронутых файлах.
- Интеграционные тесты Postgres пропускаются без `VYCORD_TEST_DSN`. Если Postgres доступен (`make docker-up`), прогнать с `VYCORD_TEST_DSN=postgres://vycord:vycord_secret@localhost:5432/postgres?sslmode=disable`; если нет — записать в отчёт задачи, что тест только скомпилирован (`go vet` его проходит), но не исполнен.

## Review Focus

1. **Запоздалый старт рекордера.** Пользователь отпустил кнопку (или отменил), пока браузер спрашивал разрешение / открывал микрофон. Ожидание: когда `getUserMedia` всё-таки резолвится, трек немедленно освобождается (индикатор микрофона в ОС гаснет), ничего не записывается и не отправляется. Тест — Task 13, «late start is released».
2. **Смена канала во время записи.** Запись начата в канале A, пользователь переключился на B. Ожидание: запись отменена и освобождена, в B ничего не уходит. Тест — Task 13, «channel change discards».
3. **`<audio>.duration === Infinity` / `NaN`** (WebM из MediaRecorder). Ожидание: пузырь показывает `duration_ms`, никогда «Infinity»/«NaN», перемотка считает по `duration_ms`. Тест — Task 11, «infinite duration falls back».
4. **Протухшая подпись голосового.** Ожидание: одна попытка `getAttachment` на `onError`, для `blob:`-URL оптимистичной строки — ни одной. Тест — Task 10, `useSelfHealingSrc`.
5. **Клавиатура: автоповтор и двойной триггер.** Зажатый Space/Enter шлёт `keydown` с `repeat=true`, а отпускание Space на `<button>` порождает `click`. Ожидание: ровно одна закреплённая запись, никаких подсказок «удерживайте». Тест — Task 13, «keyboard start once».

---

## File Structure

**Сервер (`server/`)**

| Файл | Ответственность |
|---|---|
| `migrations/027_voice_messages.up.sql` / `.down.sql` | колонки голосового + `voice_listens` |
| `internal/domain/attachment.go` | `VoiceMeta`, `VoiceListened`, константы, новые поля и методы интерфейсов |
| `internal/domain/errors.go` | `ErrVoiceInvalid`, `ErrVoiceMessageInvalid` |
| `internal/repository/postgres/attachment.go` | колонки в scan/insert, `ListByIDs`, `MarkListened`, `ListenedFor` |
| `internal/repository/postgres/migration027_integration_test.go` | CHECK + `ListenedFor` на живой БД |
| `internal/usecase/mediatype.go` | `VoiceFileName(head)` |
| `internal/usecase/attachment.go` | voice-ветка `Upload`, `MarkListened` |
| `internal/usecase/message.go` | правило голосового сообщения, `attachToMessages(msgs, viewerID)` |
| `internal/delivery/http/httperr/httperr.go` | `CodeVoiceInvalid`, `CodeVoiceMessageInvalid` |
| `internal/delivery/http/handler/attachment.go` | voice-части формы, `MarkListened`, нотификатор |
| `internal/delivery/http/handler/message.go` | маппинг `ErrVoiceMessageInvalid` |
| `cmd/api/main.go` | маршрут `/listen` + проводка нотификатора в хаб |
| моки: `internal/usecase/attachment_mock_test.go`, `internal/attachments/janitor_test.go`, `internal/delivery/http/handler/attachment_test.go` | новые методы интерфейсов |

**Клиент (`client/src/`)**

| Файл | Ответственность |
|---|---|
| `types/index.ts` | поля голосового в `Attachment` |
| `services/api.ts` | `uploadAttachment(…, voice?)`, `markVoiceListened` |
| `i18n/locales/ru.ts`, `en.ts` | namespace `voice`, коды ошибок |
| `voice/voiceGesture.ts` (+ `__tests__`) | чистая state machine жеста |
| `voice/waveform.ts` (+ `__tests__`) | `downsampleWaveform`, base64 кодек |
| `voice/voiceRecorder.ts` (+ `__tests__`) | MediaRecorder + Analyser, `pickMimeType`, `voiceFileName`, `release()` |
| `voice/sendVoice.ts` (+ `__tests__`) | оптимистичная отправка, retry, discard |
| `voice/listened.ts` (+ `__tests__`) | `applyVoiceListened`, `isVoiceMessage` |
| `stores/messageStore.ts` | `pendingVoice` в `ChatMessage`, `applyListened` |
| `stores/voicePlaybackStore.ts` (+ `__tests__`) | скорость 1x/1.5x/2x + localStorage |
| `utils/formatTime.ts` | общий формат `m:ss` |
| `utils/chatMediaCoordinator.ts` | `pauseCurrent()` |
| `hooks/useMediaPlayback.ts` | общий плеер-хук (из `AudioPlayer`) |
| `hooks/useSelfHealingSrc.ts` (+ `__tests__`) | самопочинка подписи (из `AttachmentImage`) |
| `components/AudioPlayer.tsx`, `VideoPlayer.tsx`, `MessageAttachments.tsx` | переход на общий код, маршрутизация голосового |
| `components/VoiceWaveform.tsx` | 64 столбика + перемотка (pointer + клавиатура) |
| `components/VoiceMessage.tsx` + `.css` | пузырь голосового |
| `components/MessageRow.tsx`, `mobile/chat/useMessageActions.tsx` | скрыть «Редактировать»/«Цитировать» у голосового |
| `components/ChatArea.tsx` | `sendVoice`/retry/discard, подписка `voice_listened`, проп `onSendVoice` |
| `hooks/useVoiceRecording.ts` (+ `__tests__`) | связка жест ↔ рекордер ↔ DOM |
| `components/VoiceRecorderBar.tsx` + `.css` | полоса записи / закреплённой записи |
| `components/Composer.tsx` + `Composer.css` | кнопка микрофона, полоса, подсказка |

---

### Task 1: Миграция, домен, репозиторий

**Files:**
- Create: `server/migrations/027_voice_messages.up.sql`, `server/migrations/027_voice_messages.down.sql`
- Modify: `server/internal/domain/attachment.go`, `server/internal/domain/errors.go`
- Modify: `server/internal/repository/postgres/attachment.go`
- Modify (моки): `server/internal/usecase/attachment_mock_test.go`, `server/internal/attachments/janitor_test.go`
- Test: `server/internal/repository/postgres/migration027_integration_test.go`

**Interfaces:**
- Produces:
  - `domain.VoiceWaveformLen = 64`, `domain.VoiceMinDurationMs = 1000`, `domain.VoiceMaxDurationMs = 900000`
  - `type domain.VoiceMeta struct { DurationMs int; Waveform []byte }` + `func (v VoiceMeta) Valid() bool`
  - `type domain.VoiceListened struct { ChannelID, MessageID, AttachmentID, UserID uuid.UUID }` (json: `channel_id`, `message_id`, `attachment_id`, `user_id`)
  - `domain.Attachment` поля: `IsVoice bool`, `DurationMs *int`, `Waveform []byte`, `Listened *bool`
  - `domain.AttachmentUpload.Voice *VoiceMeta`
  - `AttachmentRepository`: `ListByIDs(ids []uuid.UUID) ([]*Attachment, error)`, `MarkListened(attachmentID, userID uuid.UUID) (bool, error)`, `ListenedFor(viewerID uuid.UUID, attachmentIDs []uuid.UUID) (map[uuid.UUID]bool, error)`
  - (Метод `AttachmentUseCase.MarkListened` в этой задаче **не** объявлять — его вместе с реализацией и моком добавляет Task 5, иначе сборка сломается между задачами.)
  - `domain.ErrVoiceInvalid`, `domain.ErrVoiceMessageInvalid`

- [ ] **Step 1: Написать миграцию**

`server/migrations/027_voice_messages.up.sql`:
```sql
-- +migrate Up
-- VYC-101: голосовые сообщения. Голосовое — обычное вложение kind='audio'
-- с метаданными, которые считает клиент при записи: у WebM из MediaRecorder
-- duration часто Infinity, а декодировать opus/aac на сервере без cgo — новая
-- зависимость ради косметики. Сервер проверяет только диапазоны (этот CHECK
-- дублирует проверку usecase — последний рубеж).
ALTER TABLE attachments
    ADD COLUMN IF NOT EXISTS is_voice    BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS duration_ms INT,
    ADD COLUMN IF NOT EXISTS waveform    BYTEA;

ALTER TABLE attachments ADD CONSTRAINT attachments_voice_check CHECK (
    NOT is_voice OR (
        kind = 'audio'
        AND duration_ms BETWEEN 1000 AND 900000
        AND waveform IS NOT NULL
        AND octet_length(waveform) = 64
    )
);

-- Кто начинал воспроизведение голосового. Прослушивание автором не пишется
-- (usecase отсекает), поэтому «есть строка» для автора означает «слушал кто-то другой».
CREATE TABLE IF NOT EXISTS voice_listens (
    attachment_id UUID NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    listened_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (attachment_id, user_id)
);
```

`server/migrations/027_voice_messages.down.sql`:
```sql
-- +migrate Down
DROP TABLE IF EXISTS voice_listens;
ALTER TABLE attachments DROP CONSTRAINT IF EXISTS attachments_voice_check;
ALTER TABLE attachments
    DROP COLUMN IF EXISTS waveform,
    DROP COLUMN IF EXISTS duration_ms,
    DROP COLUMN IF EXISTS is_voice;
```

- [ ] **Step 2: Домен**

В `server/internal/domain/errors.go` рядом с `ErrStorageQuotaExceeded` добавить:
```go
	// ErrVoiceInvalid — метаданные голосового вне диапазонов или файл не
	// опознан как аудио-контейнер.
	ErrVoiceInvalid = errors.New("invalid voice message attachment")
	// ErrVoiceMessageInvalid — голосовое не единственное вложение сообщения,
	// у сообщения есть текст, либо голосовое пытаются отредактировать.
	ErrVoiceMessageInvalid = errors.New("voice message must be a single voice attachment without text")
```

В `server/internal/domain/attachment.go`:
```go
// Контракт голосового (VYC-101). Значения дублирует CHECK миграции 027.
const (
	VoiceWaveformLen   = 64
	VoiceMinDurationMs = 1000
	VoiceMaxDurationMs = 900000
)

// VoiceMeta — метаданные голосового, посчитанные клиентом при записи.
// Доверие клиенту здесь достаточное: это косметика его собственного
// сообщения, а диапазон и размер проверяются.
type VoiceMeta struct {
	DurationMs int
	Waveform   []byte
}

func (v VoiceMeta) Valid() bool {
	return v.DurationMs >= VoiceMinDurationMs && v.DurationMs <= VoiceMaxDurationMs &&
		len(v.Waveform) == VoiceWaveformLen
}

// VoiceListened — событие «получатель начал слушать голосовое» для WS.
type VoiceListened struct {
	ChannelID    uuid.UUID `json:"channel_id"`
	MessageID    uuid.UUID `json:"message_id"`
	AttachmentID uuid.UUID `json:"attachment_id"`
	UserID       uuid.UUID `json:"user_id"`
}
```
В структуру `Attachment` после `ExpiresAt` добавить:
```go
	IsVoice    bool   `json:"is_voice,omitempty"`
	DurationMs *int   `json:"duration_ms,omitempty"`
	Waveform   []byte `json:"waveform,omitempty"` // base64 в JSON
	// Listened вычисляется для конкретного зрителя и в БД не хранится: для
	// автора — «слушал кто-то», для остальных — «слушал я». nil у
	// не-голосовых и там, где зрителя нет (гостевой чат).
	Listened *bool `json:"listened,omitempty"`
```
В `AttachmentUpload` добавить поле `Voice *VoiceMeta // nil — обычное вложение`.
В `AttachmentRepository` добавить:
```go
	// ListByIDs — вложения по id (порядок не гарантирован). Нужен правилу
	// голосового сообщения, которое проверяется ДО привязки.
	ListByIDs(ids []uuid.UUID) ([]*Attachment, error)
	// MarkListened идемпотентна: inserted=false, если строка уже была.
	MarkListened(attachmentID, userID uuid.UUID) (inserted bool, err error)
	// ListenedFor отдаёт id голосовых из attachmentIDs, которые для viewerID
	// считаются прослушанными (для автора — кем-то, иначе — им самим).
	ListenedFor(viewerID uuid.UUID, attachmentIDs []uuid.UUID) (map[uuid.UUID]bool, error)
```

- [ ] **Step 3: Написать падающий интеграционный тест**

`server/internal/repository/postgres/migration027_integration_test.go`:
```go
package postgres_test

import (
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/vycord/server/internal/repository/postgres"
)

type voiceFixture struct {
	pool                         *pgxpool.Pool
	author, listener, channelID  uuid.UUID
	messageID                    uuid.UUID
}

func newVoiceFixture(t *testing.T) *voiceFixture {
	t.Helper()
	pool := openIntegrationDB(t)
	author := seedUser(t, pool)
	listener := seedUser(t, pool)
	server := seedServer(t, pool, author, false)
	channel := seedChannel(t, pool, server)
	msg := uuid.New()
	require.NoError(t, execErr(pool, `INSERT INTO messages (id, channel_id, user_id, content) VALUES ($1, $2, $3, '')`, msg, channel, author))
	return &voiceFixture{pool: pool, author: author, listener: listener, channelID: channel, messageID: msg}
}

func (f *voiceFixture) insertVoice(t *testing.T, durationMs int, waveformLen int) (uuid.UUID, error) {
	t.Helper()
	id := uuid.New()
	err := execErr(f.pool, `
		INSERT INTO attachments (id, user_id, channel_id, message_id, kind, file_name, content_type,
			size_bytes, storage_key, is_voice, duration_ms, waveform)
		VALUES ($1, $2, $3, $4, 'audio', 'voice.weba', 'audio/webm', 10, 'k', true, $5, $6)`,
		id, f.author, f.channelID, f.messageID, durationMs, make([]byte, waveformLen))
	return id, err
}

func TestMigration027_VoiceCheck(t *testing.T) {
	f := newVoiceFixture(t)

	_, err := f.insertVoice(t, 999, 64)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "attachments_voice_check")

	_, err = f.insertVoice(t, 900001, 64)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "attachments_voice_check")

	_, err = f.insertVoice(t, 5000, 63)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "attachments_voice_check")

	_, err = f.insertVoice(t, 5000, 64)
	require.NoError(t, err)
}

func TestAttachmentRepository_ListenedFor(t *testing.T) {
	f := newVoiceFixture(t)
	voiceID, err := f.insertVoice(t, 5000, 64)
	require.NoError(t, err)
	repo := postgres.NewAttachmentRepository(f.pool)

	got, err := repo.ListenedFor(f.author, []uuid.UUID{voiceID})
	require.NoError(t, err)
	assert.False(t, got[voiceID], "никто не слушал — у автора не прослушано")

	inserted, err := repo.MarkListened(voiceID, f.listener)
	require.NoError(t, err)
	assert.True(t, inserted)
	inserted, err = repo.MarkListened(voiceID, f.listener)
	require.NoError(t, err)
	assert.False(t, inserted, "повтор идемпотентен")

	got, err = repo.ListenedFor(f.author, []uuid.UUID{voiceID})
	require.NoError(t, err)
	assert.True(t, got[voiceID], "автор видит, что слушал кто-то")

	got, err = repo.ListenedFor(f.listener, []uuid.UUID{voiceID})
	require.NoError(t, err)
	assert.True(t, got[voiceID], "слушатель видит своё прослушивание")

	third := seedUser(t, f.pool)
	got, err = repo.ListenedFor(third, []uuid.UUID{voiceID})
	require.NoError(t, err)
	assert.False(t, got[voiceID], "третий ещё не слушал")

	atts, err := repo.ListByIDs([]uuid.UUID{voiceID})
	require.NoError(t, err)
	require.Len(t, atts, 1)
	assert.True(t, atts[0].IsVoice)
	require.NotNil(t, atts[0].DurationMs)
	assert.Equal(t, 5000, *atts[0].DurationMs)
	assert.Len(t, atts[0].Waveform, 64)
}
```

- [ ] **Step 4: Убедиться, что не компилируется / падает**

Run: `cd server && go vet ./internal/repository/postgres/`
Expected: ошибки компиляции — `repo.ListenedFor undefined` и т.п.

- [ ] **Step 5: Реализовать репозиторий**

В `server/internal/repository/postgres/attachment.go`:
```go
const attachmentColumns = `id, user_id, channel_id, message_id, kind, file_name,
	content_type, size_bytes, storage_key, thumb_key, width, height, expires_at, created_at,
	is_voice, duration_ms, waveform`

func scanAttachment(row pgx.Row) (*domain.Attachment, error) {
	a := &domain.Attachment{}
	var thumbKey *string
	err := row.Scan(&a.ID, &a.UserID, &a.ChannelID, &a.MessageID, &a.Kind, &a.FileName,
		&a.ContentType, &a.SizeBytes, &a.StorageKey, &thumbKey, &a.Width, &a.Height,
		&a.ExpiresAt, &a.CreatedAt, &a.IsVoice, &a.DurationMs, &a.Waveform)
	// … остальное без изменений
```
В `Create` добавить три колонки в INSERT (`…, created_at, is_voice, duration_ms, waveform) VALUES ($1,…,$14,$15,$16,$17)`) и аргументы `a.IsVoice, a.DurationMs, a.Waveform`. У не-голосового `Waveform` = nil → NULL.

Новые методы:
```go
func (r *attachmentRepository) ListByIDs(ids []uuid.UUID) ([]*domain.Attachment, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	rows, err := r.db.Query(ctx, `SELECT `+attachmentColumns+` FROM attachments WHERE id = ANY($1)`, ids)
	if err != nil {
		return nil, fmt.Errorf("failed to list attachments by id: %w", err)
	}
	defer rows.Close()

	var out []*domain.Attachment
	for rows.Next() {
		a, err := scanAttachment(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan attachment: %w", err)
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (r *attachmentRepository) MarkListened(attachmentID, userID uuid.UUID) (bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	tag, err := r.db.Exec(ctx, `
		INSERT INTO voice_listens (attachment_id, user_id) VALUES ($1, $2)
		ON CONFLICT (attachment_id, user_id) DO NOTHING`, attachmentID, userID)
	if err != nil {
		return false, fmt.Errorf("failed to mark voice listened: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}

// ListenedFor — одним запросом на пачку. Прослушивания автора не пишутся,
// поэтому для автора условие a.user_id = viewer означает «слушал кто-то другой».
func (r *attachmentRepository) ListenedFor(viewerID uuid.UUID, attachmentIDs []uuid.UUID) (map[uuid.UUID]bool, error) {
	out := make(map[uuid.UUID]bool, len(attachmentIDs))
	if len(attachmentIDs) == 0 {
		return out, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	rows, err := r.db.Query(ctx, `
		SELECT a.id FROM attachments a
		WHERE a.id = ANY($2) AND a.is_voice
		  AND EXISTS (SELECT 1 FROM voice_listens l
		              WHERE l.attachment_id = a.id
		                AND (a.user_id = $1 OR l.user_id = $1))`, viewerID, attachmentIDs)
	if err != nil {
		return nil, fmt.Errorf("failed to query voice listens: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("failed to scan voice listen: %w", err)
		}
		out[id] = true
	}
	return out, rows.Err()
}
```

- [ ] **Step 6: Обновить моки репозитория**

В `server/internal/usecase/attachment_mock_test.go` добавить:
```go
func (m *MockAttachmentRepository) ListByIDs(ids []uuid.UUID) ([]*domain.Attachment, error) {
	args := m.Called(ids)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).([]*domain.Attachment), args.Error(1)
}

func (m *MockAttachmentRepository) MarkListened(attachmentID, userID uuid.UUID) (bool, error) {
	args := m.Called(attachmentID, userID)
	return args.Bool(0), args.Error(1)
}

func (m *MockAttachmentRepository) ListenedFor(viewerID uuid.UUID, ids []uuid.UUID) (map[uuid.UUID]bool, error) {
	args := m.Called(viewerID, ids)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(map[uuid.UUID]bool), args.Error(1)
}
```
В `server/internal/attachments/janitor_test.go` у `MockRepo` добавить те же три метода с тем же телом (заменив получатель на `*MockRepo`).

- [ ] **Step 7: Прогнать**

Run: `cd server && go vet ./... && go test ./internal/repository/postgres/ ./internal/usecase/ ./internal/attachments/`
Expected: vet чист; тесты `ok`. Если есть Postgres: `VYCORD_TEST_DSN=… go test ./internal/repository/postgres/ -run 'Migration027|ListenedFor' -v` → оба PASS. Иначе — в отчёте: «интеграционный тест скомпилирован, но пропущен (нет VYCORD_TEST_DSN)».

- [ ] **Step 8: Commit**
```bash
git add server/migrations/027_voice_messages.up.sql server/migrations/027_voice_messages.down.sql \
  server/internal/domain/attachment.go server/internal/domain/errors.go \
  server/internal/repository/postgres/attachment.go server/internal/repository/postgres/migration027_integration_test.go \
  server/internal/usecase/attachment_mock_test.go server/internal/attachments/janitor_test.go
git commit -m "VYC-101 server: миграция 027, домен и репозиторий голосовых"
```

---

### Task 2: `VoiceFileName` и voice-ветка загрузки в usecase

**Files:**
- Modify: `server/internal/usecase/mediatype.go`, `server/internal/usecase/attachment.go`
- Test: `server/internal/usecase/mediatype_test.go`, `server/internal/usecase/attachment_test.go`

**Interfaces:**
- Consumes: `domain.VoiceMeta`, `domain.ErrVoiceInvalid`, поля `Attachment.IsVoice/DurationMs/Waveform` (Task 1).
- Produces: `usecase.VoiceFileName(head []byte) (string, bool)`.

- [ ] **Step 1: Падающие тесты `mediatype_test.go`**

В таблицу `TestDetectKind` добавить три кейса (хелпер `webmHeader()` уже есть, `isoHeader("M4A ")` тоже):
```go
		{
			name:            "EBML с .weba — аудио (имя голосового)",
			head:            webmHeader(),
			fileName:        "voice.weba",
			wantKind:        domain.AttachmentKindAudio,
			wantContentType: "audio/webm",
		},
		{
			// Ловушка VYC-101: MediaRecorder даёт audio/webm, но с именем
			// .webm DetectKind видит видео. Поэтому имя голосового выбирает
			// сервер (VoiceFileName), а не клиент.
			name:            "EBML с .webm остаётся видео — ловушка голосового",
			head:            webmHeader(),
			fileName:        "voice.webm",
			wantKind:        domain.AttachmentKindVideo,
			wantContentType: "video/webm",
		},
		{
			name:            "ftyp с .m4a — аудио (Safari MediaRecorder)",
			head:            isoHeader("M4A "),
			fileName:        "voice.m4a",
			wantKind:        domain.AttachmentKindAudio,
			wantContentType: "audio/mp4",
		},
```
И новый тест в конец файла:
```go
func TestVoiceFileName(t *testing.T) {
	tests := []struct {
		name   string
		head   []byte
		want   string
		wantOK bool
	}{
		{"webm", webmHeader(), "voice.weba", true},
		{"mp4", isoHeader("M4A "), "voice.m4a", true},
		{"ogg", append([]byte("OggS"), make([]byte, 28)...), "voice.ogg", true},
		{"png — не голосовое", []byte("\x89PNG\r\n\x1a\n" + string(make([]byte, 24))), "", false},
		{"пусто", nil, "", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := usecase.VoiceFileName(tt.head)
			assert.Equal(t, tt.wantOK, ok)
			assert.Equal(t, tt.want, got)
		})
	}
}
```

- [ ] **Step 2: Падающие тесты `attachment_test.go`**

```go
func voiceMeta() *domain.VoiceMeta {
	return &domain.VoiceMeta{DurationMs: 4200, Waveform: make([]byte, domain.VoiceWaveformLen)}
}

func webmBytes() []byte { return append([]byte{0x1A, 0x45, 0xDF, 0xA3}, make([]byte, 60)...) }

func TestUploadVoiceRenamesByContainerAndStoresMeta(t *testing.T) {
	f := newAttachFixture(t)
	f.quota.On("CheckUpload", f.userID, mock.Anything).Return(nil)
	f.quota.On("ExpiresAt", f.userID, mock.Anything).Return(nil, nil)
	f.storage.On("Save", mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return("", nil)
	f.repo.On("Create", mock.Anything).Return(nil)

	in := f.upload("recording.webm", webmBytes()) // клиент прислал «видео»-имя
	in.Voice = voiceMeta()
	att, err := f.uc.Upload(in)

	require.NoError(t, err)
	assert.Equal(t, domain.AttachmentKindAudio, att.Kind)
	assert.Equal(t, "voice.weba", att.FileName)
	assert.True(t, att.IsVoice)
	require.NotNil(t, att.DurationMs)
	assert.Equal(t, 4200, *att.DurationMs)
	assert.Len(t, att.Waveform, domain.VoiceWaveformLen)
}

func TestUploadVoiceRejectsOutOfRangeMeta(t *testing.T) {
	for _, meta := range []*domain.VoiceMeta{
		{DurationMs: 999, Waveform: make([]byte, 64)},
		{DurationMs: 900001, Waveform: make([]byte, 64)},
		{DurationMs: 5000, Waveform: make([]byte, 10)},
	} {
		f := newAttachFixture(t)
		in := f.upload("v.weba", webmBytes())
		in.Voice = meta
		_, err := f.uc.Upload(in)
		assert.ErrorIs(t, err, domain.ErrVoiceInvalid)
		f.storage.AssertNotCalled(t, "Save", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
	}
}

func TestUploadVoiceRejectsNonAudioContainer(t *testing.T) {
	f := newAttachFixture(t)
	f.quota.On("CheckUpload", f.userID, mock.Anything).Return(nil)
	in := f.upload("v.weba", []byte("\x89PNG\r\n\x1a\n"+string(make([]byte, 24))))
	in.Voice = voiceMeta()
	_, err := f.uc.Upload(in)
	assert.ErrorIs(t, err, domain.ErrVoiceInvalid)
}

func TestUploadVoiceRejectsHeicDisguisedAsM4A(t *testing.T) {
	// ftyp с image-брендом: VoiceFileName даст voice.m4a, но DetectKind
	// разберёт бренд и скажет image — это не голосовое.
	f := newAttachFixture(t)
	f.quota.On("CheckUpload", f.userID, mock.Anything).Return(nil)
	h := make([]byte, 32)
	copy(h[4:], "ftypheic")
	in := f.upload("v.m4a", h)
	in.Voice = voiceMeta()
	_, err := f.uc.Upload(in)
	assert.ErrorIs(t, err, domain.ErrVoiceInvalid)
}
```
(Если `MockStorage.Save` в этом пакете имеет иную сигнатуру — свериться с `TestUploadStoresFileAndRow` и повторить его `On("Save", …)` дословно.)

- [ ] **Step 3: Прогнать — падают**

Run: `cd server && go test ./internal/usecase/ -run 'DetectKind|VoiceFileName|UploadVoice' -v`
Expected: FAIL/compile error — `usecase.VoiceFileName undefined`.

- [ ] **Step 4: Реализация**

В `server/internal/usecase/mediatype.go` добавить:
```go
// VoiceFileName выбирает имя голосового по сигнатуре контейнера (VYC-101).
// Имя от клиента для голосового не используется: MediaRecorder в Chromium
// пишет audio/webm, и файл «voice.webm» DetectKind честно счёл бы видео.
// Здесь только выбор расширения — вид всё равно решает DetectKind, так что
// ftyp с image-брендом отсеется им как картинка.
func VoiceFileName(head []byte) (string, bool) {
	switch {
	case len(head) >= 4 && bytes.Equal(head[:4], []byte{0x1A, 0x45, 0xDF, 0xA3}):
		return "voice.weba", true
	case len(head) >= 12 && bytes.Equal(head[4:8], []byte("ftyp")):
		return "voice.m4a", true
	case len(head) >= 4 && bytes.Equal(head[:4], []byte("OggS")):
		return "voice.ogg", true
	}
	return "", false
}
```
В `server/internal/usecase/attachment.go` в `Upload`:
- сразу после проверки прав:
```go
	if in.Voice != nil && !in.Voice.Valid() {
		return nil, domain.ErrVoiceInvalid
	}
```
- заменить блок `safeName := …; kind, contentType := DetectKind(head, safeName)` на:
```go
	safeName := filename.Sanitize(in.FileName)
	if in.Voice != nil {
		name, ok := VoiceFileName(head)
		if !ok {
			return nil, domain.ErrVoiceInvalid
		}
		safeName = name
	}
	kind, contentType := DetectKind(head, safeName)
	if in.Voice != nil && kind != domain.AttachmentKindAudio {
		return nil, domain.ErrVoiceInvalid
	}
```
- в литерал `att := &domain.Attachment{…}` ничего не добавлять; сразу после него:
```go
	if in.Voice != nil {
		d := in.Voice.DurationMs
		att.IsVoice = true
		att.DurationMs = &d
		att.Waveform = in.Voice.Waveform
	}
```

- [ ] **Step 5: Прогнать — зелёные**

Run: `cd server && go test ./internal/usecase/ -v -run 'DetectKind|VoiceFileName|Upload'`
Expected: PASS, включая старые `TestUpload*`.

- [ ] **Step 6: Commit**
```bash
git add server/internal/usecase/mediatype.go server/internal/usecase/mediatype_test.go \
  server/internal/usecase/attachment.go server/internal/usecase/attachment_test.go
git commit -m "VYC-101 server: имя голосового по контейнеру, voice-ветка загрузки"
```

---

### Task 3: Хендлер загрузки — voice-части формы и коды ошибок

**Files:**
- Modify: `server/internal/delivery/http/httperr/httperr.go`, `server/internal/delivery/http/handler/attachment.go`
- Test: `server/internal/delivery/http/handler/attachment_test.go`

**Interfaces:**
- Consumes: `domain.AttachmentUpload.Voice`, `domain.ErrVoiceInvalid`.
- Produces: `httperr.CodeVoiceInvalid = "voice_invalid"`, `httperr.CodeVoiceMessageInvalid = "voice_message_invalid"`. Контракт формы: части `voice` (`"1"`), `duration_ms` (десятичное), `waveform` (std base64).

- [ ] **Step 1: Падающие тесты**

В `attachment_test.go` добавить хелпер и тесты:
```go
func newVoiceUploadRequest(t *testing.T, channelID uuid.UUID, duration, waveform string, userID uuid.UUID) *http.Request {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	require.NoError(t, w.WriteField("channel_id", channelID.String()))
	require.NoError(t, w.WriteField("voice", "1"))
	require.NoError(t, w.WriteField("duration_ms", duration))
	require.NoError(t, w.WriteField("waveform", waveform))
	fw, err := w.CreateFormFile("file", "voice.webm")
	require.NoError(t, err)
	_, _ = fw.Write([]byte("data"))
	require.NoError(t, w.Close())
	req := httptest.NewRequest(http.MethodPost, "/api/v1/attachments", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	return req.WithContext(context.WithValue(req.Context(), "user_id", userID))
}

func TestUploadPassesVoiceMetaToUseCase(t *testing.T) {
	channelID, userID := uuid.New(), uuid.New()
	wf := base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{7}, 64))
	uc := new(MockAttachmentUseCase)
	uc.On("Upload", mock.MatchedBy(func(in domain.AttachmentUpload) bool {
		return in.Voice != nil && in.Voice.DurationMs == 4200 && len(in.Voice.Waveform) == 64 && in.Voice.Waveform[0] == 7
	})).Return(&domain.Attachment{ID: uuid.New(), Kind: domain.AttachmentKindAudio, IsVoice: true}, nil)

	rec := httptest.NewRecorder()
	newAttachmentHandler(uc).Upload(rec, newVoiceUploadRequest(t, channelID, "4200", wf, userID))

	assert.Equal(t, http.StatusCreated, rec.Code)
	uc.AssertExpectations(t)
}

func TestUploadRejectsMalformedVoiceFields(t *testing.T) {
	for _, tc := range []struct{ duration, waveform string }{
		{"abc", base64.StdEncoding.EncodeToString(make([]byte, 64))},
		{"4200", "%%%не-base64%%%"},
	} {
		uc := new(MockAttachmentUseCase)
		rec := httptest.NewRecorder()
		newAttachmentHandler(uc).Upload(rec, newVoiceUploadRequest(t, uuid.New(), tc.duration, tc.waveform, uuid.New()))
		assert.Equal(t, http.StatusBadRequest, rec.Code)
		assert.Contains(t, rec.Body.String(), "voice_invalid")
		uc.AssertNotCalled(t, "Upload", mock.Anything)
	}
}

func TestUploadMapsVoiceInvalidTo400(t *testing.T) {
	uc := new(MockAttachmentUseCase)
	uc.On("Upload", mock.Anything).Return(nil, domain.ErrVoiceInvalid)
	rec := httptest.NewRecorder()
	wf := base64.StdEncoding.EncodeToString(make([]byte, 64))
	newAttachmentHandler(uc).Upload(rec, newVoiceUploadRequest(t, uuid.New(), "10", wf, uuid.New()))
	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "voice_invalid")
}

func TestUploadWithoutVoiceFieldLeavesVoiceNil(t *testing.T) {
	uc := new(MockAttachmentUseCase)
	uc.On("Upload", mock.MatchedBy(func(in domain.AttachmentUpload) bool { return in.Voice == nil })).
		Return(&domain.Attachment{ID: uuid.New()}, nil)
	rec := httptest.NewRecorder()
	newAttachmentHandler(uc).Upload(rec, newUploadRequest(t, uuid.New(), "a.bin", []byte("x"), uuid.New()))
	assert.Equal(t, http.StatusCreated, rec.Code)
	uc.AssertExpectations(t)
}
```
Импорт `encoding/base64` добавить. (Как `user_id` кладётся в контекст — свериться с `newUploadRequest` в этом файле и повторить тот же приём дословно.)

- [ ] **Step 2: Прогнать — падают**

Run: `cd server && go test ./internal/delivery/http/handler/ -run 'Voice' -v`
Expected: FAIL (`in.Voice` всегда nil; нет `voice_invalid`).

- [ ] **Step 3: Коды ошибок**

В `httperr.go` рядом с `CodeAttachmentTooLarge`:
```go
	CodeVoiceInvalid        = "voice_invalid"
	CodeVoiceMessageInvalid = "voice_message_invalid"
```

- [ ] **Step 4: Хендлер**

В `Upload` в блок `var (…)` добавить `voiceFlag, voiceDuration, voiceWaveform string`. В `switch part.FormName()` перед `default:`:
```go
		case "voice", "duration_ms", "waveform":
			// Маленькие текстовые поля голосового (VYC-101). 256 байт хватает
			// base64 от 64 байт волны (88 символов) с запасом.
			raw, err := io.ReadAll(io.LimitReader(part, 256))
			name := part.FormName()
			part.Close()
			if err != nil {
				h.drainBody(r)
				h.sendError(w, http.StatusBadRequest, httperr.CodeVoiceInvalid, "invalid voice fields")
				return
			}
			switch name {
			case "voice":
				voiceFlag = string(raw)
			case "duration_ms":
				voiceDuration = string(raw)
			case "waveform":
				voiceWaveform = string(raw)
			}
```
После цикла, перед `h.uc.Upload`:
```go
	var voice *domain.VoiceMeta
	if voiceFlag == "1" {
		// Здесь только разбор; диапазоны — в usecase, единственном владельце правила.
		d, errD := strconv.Atoi(voiceDuration)
		wf, errW := base64.StdEncoding.DecodeString(voiceWaveform)
		if errD != nil || errW != nil {
			h.sendError(w, http.StatusBadRequest, httperr.CodeVoiceInvalid, "invalid voice fields")
			return
		}
		voice = &domain.VoiceMeta{DurationMs: d, Waveform: wf}
	}
```
и `Voice: voice,` в литерал `domain.AttachmentUpload{…}`. Импорты: `encoding/base64`, `strconv`.
В `writeError` перед веткой `ErrForbidden`:
```go
	case errors.Is(err, domain.ErrVoiceInvalid):
		h.sendError(w, http.StatusBadRequest, httperr.CodeVoiceInvalid, "invalid voice message attachment")
```

- [ ] **Step 5: Прогнать**

Run: `cd server && go test ./internal/delivery/http/... -v -run 'Upload'`
Expected: PASS все `TestUpload*`, включая старые. Если `httperr_test.go` проверяет уникальность/список кодов — прогнать `go test ./internal/delivery/http/httperr/` и дополнить список, если тест этого требует.

- [ ] **Step 6: Commit**
```bash
git add server/internal/delivery/http/httperr/httperr.go server/internal/delivery/http/handler/attachment.go \
  server/internal/delivery/http/handler/attachment_test.go
git commit -m "VYC-101 server: voice-поля в загрузке вложения"
```

---

### Task 4: Правила голосового сообщения и `listened` в выдаче

**Files:**
- Modify: `server/internal/usecase/message.go`, `server/internal/delivery/http/handler/message.go`
- Test: `server/internal/usecase/message_test.go`

**Interfaces:**
- Consumes: `AttachmentRepository.ListByIDs`, `ListenedFor` (Task 1), `domain.ErrVoiceMessageInvalid`, `httperr.CodeVoiceMessageInvalid` (Task 3).
- Produces: `attachToMessages(msgs []*domain.Message, viewerID uuid.UUID)` (приватный); `Attachment.Listened` заполнен у голосовых в `GetMessages`, `SearchMessages`, `GetMessagesAround`, `UpdateMessage`.

- [ ] **Step 1: Падающие тесты** (в `message_test.go`)

```go
func voiceAtt(id, owner uuid.UUID) *domain.Attachment {
	d := 3000
	return &domain.Attachment{ID: id, UserID: owner, Kind: domain.AttachmentKindAudio, IsVoice: true, DurationMs: &d, Waveform: make([]byte, 64)}
}

func newMsgUC(t *testing.T, channelID, serverID, userID uuid.UUID, msgRepo *MockMessageRepository, attachRepo *MockAttachmentRepository) domain.MessageUseCase {
	t.Helper()
	chRepo := new(MockChannelRepository)
	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	perms := permsWith(serverID, userID, domain.PermSendMessages|domain.PermViewChannels)
	return usecase.NewMessageUseCase(msgRepo, chRepo, new(MockServerRepository), &MockStickerRepository{}, perms, attachRepo, new(MockStorage))
}

func TestCreateMessage_VoiceWithText_Rejected(t *testing.T) {
	channelID, serverID, userID, attID := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	attachRepo := new(MockAttachmentRepository)
	attachRepo.On("ListByIDs", []uuid.UUID{attID}).Return([]*domain.Attachment{voiceAtt(attID, userID)}, nil)
	msgRepo := new(MockMessageRepository)

	_, err := newMsgUC(t, channelID, serverID, userID, msgRepo, attachRepo).CreateMessage(channelID, userID, "подпись", nil, []uuid.UUID{attID})

	assert.ErrorIs(t, err, domain.ErrVoiceMessageInvalid)
	msgRepo.AssertNotCalled(t, "Create", mock.Anything)
}

func TestCreateMessage_VoiceWithOtherAttachment_Rejected(t *testing.T) {
	channelID, serverID, userID, voiceID, picID := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	attachRepo := new(MockAttachmentRepository)
	attachRepo.On("ListByIDs", []uuid.UUID{voiceID, picID}).
		Return([]*domain.Attachment{voiceAtt(voiceID, userID), {ID: picID, Kind: domain.AttachmentKindImage}}, nil)
	msgRepo := new(MockMessageRepository)

	_, err := newMsgUC(t, channelID, serverID, userID, msgRepo, attachRepo).CreateMessage(channelID, userID, "", nil, []uuid.UUID{voiceID, picID})

	assert.ErrorIs(t, err, domain.ErrVoiceMessageInvalid)
	msgRepo.AssertNotCalled(t, "Create", mock.Anything)
}

func TestCreateMessage_SingleVoiceNoText_SkipsLookup(t *testing.T) {
	channelID, serverID, userID, attID := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	attachRepo := new(MockAttachmentRepository)
	attachRepo.On("AttachToMessage", mock.Anything, userID, channelID, []uuid.UUID{attID}).Return(nil)
	attachRepo.On("ListByMessageIDs", mock.Anything).Return(map[uuid.UUID][]*domain.Attachment{}, nil)
	msgRepo := new(MockMessageRepository)
	msgRepo.On("Create", mock.Anything).Return(nil)

	_, err := newMsgUC(t, channelID, serverID, userID, msgRepo, attachRepo).CreateMessage(channelID, userID, "", nil, []uuid.UUID{attID})

	require.NoError(t, err)
	attachRepo.AssertNotCalled(t, "ListByIDs", mock.Anything)
}

func TestUpdateMessage_VoiceMessage_Rejected(t *testing.T) {
	channelID, serverID, userID, messageID, attID := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	msgRepo := new(MockMessageRepository)
	msgRepo.On("GetByID", messageID).Return(&domain.Message{ID: messageID, ChannelID: channelID, UserID: &userID, Content: ""}, nil)
	attachRepo := new(MockAttachmentRepository)
	attachRepo.On("ListByMessageIDs", []uuid.UUID{messageID}).
		Return(map[uuid.UUID][]*domain.Attachment{messageID: {voiceAtt(attID, userID)}}, nil)

	_, err := newMsgUC(t, channelID, serverID, userID, msgRepo, attachRepo).UpdateMessage(channelID, messageID, userID, "текст")

	assert.ErrorIs(t, err, domain.ErrVoiceMessageInvalid)
	msgRepo.AssertNotCalled(t, "Update", mock.Anything, mock.Anything)
}

func TestGetMessages_SetsListenedForViewer(t *testing.T) {
	channelID, serverID, viewer, author, msgID, heard, unheard := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	msgRepo := new(MockMessageRepository)
	msgRepo.On("GetByChannelID", channelID, 50, 0).Return([]*domain.Message{{ID: msgID, ChannelID: channelID}}, nil)
	attachRepo := new(MockAttachmentRepository)
	attachRepo.On("ListByMessageIDs", []uuid.UUID{msgID}).Return(map[uuid.UUID][]*domain.Attachment{
		msgID: {voiceAtt(heard, author), voiceAtt(unheard, author), {ID: uuid.New(), Kind: domain.AttachmentKindImage}},
	}, nil)
	attachRepo.On("ListenedFor", viewer, mock.MatchedBy(func(ids []uuid.UUID) bool { return len(ids) == 2 })).
		Return(map[uuid.UUID]bool{heard: true}, nil)

	msgs, err := newMsgUC(t, channelID, serverID, viewer, msgRepo, attachRepo).GetMessages(channelID, viewer, 50, 0)

	require.NoError(t, err)
	atts := msgs[0].Attachments
	require.NotNil(t, atts[0].Listened)
	assert.True(t, *atts[0].Listened)
	require.NotNil(t, atts[1].Listened)
	assert.False(t, *atts[1].Listened)
	assert.Nil(t, atts[2].Listened, "у не-голосового поля нет")
}

func TestGetMessages_ListenedLookupFailureKeepsFeed(t *testing.T) {
	channelID, serverID, viewer, msgID, attID := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	msgRepo := new(MockMessageRepository)
	msgRepo.On("GetByChannelID", channelID, 50, 0).Return([]*domain.Message{{ID: msgID, ChannelID: channelID}}, nil)
	attachRepo := new(MockAttachmentRepository)
	attachRepo.On("ListByMessageIDs", mock.Anything).Return(map[uuid.UUID][]*domain.Attachment{msgID: {voiceAtt(attID, uuid.New())}}, nil)
	attachRepo.On("ListenedFor", viewer, mock.Anything).Return(nil, errors.New("db down"))

	msgs, err := newMsgUC(t, channelID, serverID, viewer, msgRepo, attachRepo).GetMessages(channelID, viewer, 50, 0)

	require.NoError(t, err)
	require.Len(t, msgs[0].Attachments, 1)
	assert.Nil(t, msgs[0].Attachments[0].Listened)
}
```
Если `permsWith` в этом файле не поддерживает маску из двух битов — посмотреть его сигнатуру и передать так, как он принимает (или вызвать дважды нужным образом); тесты `GetMessages_*` в файле уже показывают, как даётся `PermViewChannels`.

- [ ] **Step 2: Прогнать — падают**

Run: `cd server && go test ./internal/usecase/ -run 'Voice|Listened' -v`
Expected: FAIL.

- [ ] **Step 3: Реализация `message.go`**

В `CreateMessage` сразу после проверки стикера (`if stickerID != nil && len(attachmentIDs) > 0 {…}`):
```go
	// Голосовое — самостоятельный вид сообщения (VYC-101): одно голосовое
	// вложение и никакого текста. Проверяем ДО привязки: откат после
	// AttachToMessage унёс бы вложения каскадом вместе с сообщением.
	// Одиночное вложение без текста валидно при любом виде — чтение не нужно.
	if len(attachmentIDs) > 1 || (len(attachmentIDs) == 1 && content != "") {
		atts, err := uc.attachRepo.ListByIDs(attachmentIDs)
		if err != nil {
			return nil, fmt.Errorf("load attachments: %w", err)
		}
		for _, a := range atts {
			if a.IsVoice {
				return nil, domain.ErrVoiceMessageInvalid
			}
		}
	}
```
В `UpdateMessage` после проверки `IsAuthoredBy` и ДО `if msg.Content == content`:
```go
	// У голосового нечего править, а текст рядом с ним запрещён правилом
	// создания. Вложения GetByID не подтягивает — берём их явно.
	if byMsg, err := uc.attachRepo.ListByMessageIDs([]uuid.UUID{msg.ID}); err == nil {
		for _, a := range byMsg[msg.ID] {
			if a.IsVoice {
				return nil, domain.ErrVoiceMessageInvalid
			}
		}
	}
```
(Существующие тесты `UpdateMessage_*`, у которых нет `On("ListByMessageIDs")`, упадут на панике мока — добавить им `attachRepo.On("ListByMessageIDs", mock.Anything).Return(map[uuid.UUID][]*domain.Attachment{}, nil)`; `MockAttachmentRepository` там, где передаётся `new(...)` inline, вынести в переменную.)

`attachToMessages` переписать:
```go
// attachToMessages подтягивает вложения для пачки сообщений одним запросом:
// иначе список из 50 сообщений дал бы 50 походов в БД. Для голосовых
// проставляет Listened с точки зрения viewerID — тоже одним запросом.
func (uc *messageUseCase) attachToMessages(msgs []*domain.Message, viewerID uuid.UUID) {
	if len(msgs) == 0 {
		return
	}
	ids := make([]uuid.UUID, 0, len(msgs))
	for _, m := range msgs {
		ids = append(ids, m.ID)
	}
	byMsg, err := uc.attachRepo.ListByMessageIDs(ids)
	if err != nil {
		// Вложения — не критичная часть ответа: лучше отдать сообщения без
		// них, чем не отдать ничего.
		return
	}
	var voiceIDs []uuid.UUID
	for _, m := range msgs {
		m.Attachments = byMsg[m.ID]
		for _, a := range m.Attachments {
			if a.IsVoice {
				voiceIDs = append(voiceIDs, a.ID)
			}
		}
	}
	if len(voiceIDs) == 0 {
		return
	}
	listened, err := uc.attachRepo.ListenedFor(viewerID, voiceIDs)
	if err != nil {
		// Без отметки точка «не прослушано» просто не покажется — это
		// косметика, ленту из-за неё не роняем.
		return
	}
	for _, m := range msgs {
		for _, a := range m.Attachments {
			if a.IsVoice {
				v := listened[a.ID]
				a.Listened = &v
			}
		}
	}
}
```
Все четыре вызова обновить: `uc.attachToMessages(messages, userID)` (GetMessages, GetMessagesAround), `uc.attachToMessages(msgs, userID)` (SearchMessages), `uc.attachToMessages([]*domain.Message{msg}, userID)` (UpdateMessage).

Существующие тесты `CreateMessage` с текстом и одним вложением (строки ~928 и ~995 `message_test.go`: `"смотри"`, `"текст"`) теперь вызывают `ListByIDs` — добавить им:
```go
	attachRepo.On("ListByIDs", []uuid.UUID{attID}).Return([]*domain.Attachment{{ID: attID, Kind: domain.AttachmentKindImage}}, nil)
```

- [ ] **Step 4: Хендлер сообщений**

В `server/internal/delivery/http/handler/message.go` в `writeUseCaseError` рядом с `ErrStickerWithAttachments`:
```go
	case errors.Is(err, domain.ErrVoiceMessageInvalid):
		h.sendError(w, http.StatusBadRequest, httperr.CodeVoiceMessageInvalid, "voice message must be a single voice attachment without text")
```
(Сверить с фактической формой `switch` в этой функции.)

- [ ] **Step 5: Прогнать весь сервер**

Run: `make test` (из корня) и `make vet`
Expected: exit 0 оба.

- [ ] **Step 6: Commit**
```bash
git add server/internal/usecase/message.go server/internal/usecase/message_test.go server/internal/delivery/http/handler/message.go
git commit -m "VYC-101 server: правило голосового сообщения и listened в выдаче"
```

---

### Task 5: Эндпоинт «прослушано» и WS-событие

**Files:**
- Modify: `server/internal/domain/attachment.go` (интерфейс usecase), `server/internal/usecase/attachment.go`, `server/internal/delivery/http/handler/attachment.go`, `server/cmd/api/main.go`
- Test: `server/internal/usecase/attachment_test.go`, `server/internal/delivery/http/handler/attachment_test.go`

**Interfaces:**
- Consumes: `AttachmentRepository.MarkListened` (Task 1), `domain.VoiceListened`.
- Produces: `AttachmentUseCase.MarkListened(id, userID uuid.UUID) (*domain.VoiceListened, error)`; `(*AttachmentHandler).MarkListened`; `(*AttachmentHandler).SetVoiceListenedNotifier(func(*domain.VoiceListened))`; маршрут `POST /api/v1/attachments/{id}/listen` → 204; WS `voice_listened`.

- [ ] **Step 1: Падающие тесты usecase**

```go
func (f *attachFixture) voiceRow(owner uuid.UUID, attached bool) *domain.Attachment {
	a := &domain.Attachment{ID: uuid.New(), UserID: owner, ChannelID: f.channelID, Kind: domain.AttachmentKindAudio, IsVoice: true}
	if attached {
		m := uuid.New()
		a.MessageID = &m
	}
	return a
}

func TestMarkListenedEmitsEventOnFirstListen(t *testing.T) {
	f := newAttachFixture(t)
	att := f.voiceRow(uuid.New(), true)
	f.repo.On("GetByID", att.ID).Return(att, nil)
	f.repo.On("MarkListened", att.ID, f.userID).Return(true, nil)

	ev, err := f.uc.MarkListened(att.ID, f.userID)

	require.NoError(t, err)
	require.NotNil(t, ev)
	assert.Equal(t, domain.VoiceListened{ChannelID: f.channelID, MessageID: *att.MessageID, AttachmentID: att.ID, UserID: f.userID}, *ev)
}

func TestMarkListenedRepeatIsSilent(t *testing.T) {
	f := newAttachFixture(t)
	att := f.voiceRow(uuid.New(), true)
	f.repo.On("GetByID", att.ID).Return(att, nil)
	f.repo.On("MarkListened", att.ID, f.userID).Return(false, nil)

	ev, err := f.uc.MarkListened(att.ID, f.userID)

	require.NoError(t, err)
	assert.Nil(t, ev)
}

func TestMarkListenedByAuthorIsNoOp(t *testing.T) {
	f := newAttachFixture(t)
	att := f.voiceRow(f.userID, true)
	f.repo.On("GetByID", att.ID).Return(att, nil)

	ev, err := f.uc.MarkListened(att.ID, f.userID)

	require.NoError(t, err)
	assert.Nil(t, ev)
	f.repo.AssertNotCalled(t, "MarkListened", mock.Anything, mock.Anything)
}

func TestMarkListenedRejectsNonVoiceUnattachedAndForeign(t *testing.T) {
	f := newAttachFixture(t)
	notVoice := &domain.Attachment{ID: uuid.New(), ChannelID: f.channelID, Kind: domain.AttachmentKindAudio}
	draft := f.voiceRow(uuid.New(), false)
	f.repo.On("GetByID", notVoice.ID).Return(notVoice, nil)
	f.repo.On("GetByID", draft.ID).Return(draft, nil)
	for _, id := range []uuid.UUID{notVoice.ID, draft.ID} {
		_, err := f.uc.MarkListened(id, f.userID)
		assert.ErrorIs(t, err, domain.ErrAttachmentNotFound)
	}

	outsider := uuid.New()
	f.perms.On("Resolve", f.serverID, outsider).Return(domain.PermissionSet{}, nil)
	att := f.voiceRow(uuid.New(), true)
	f.repo.On("GetByID", att.ID).Return(att, nil)
	_, err := f.uc.MarkListened(att.ID, outsider)
	assert.ErrorIs(t, err, domain.ErrAttachmentNotFound)
	f.repo.AssertNotCalled(t, "MarkListened", mock.Anything, mock.Anything)
}
```

- [ ] **Step 2: Падающие тесты хендлера**

В `MockAttachmentUseCase` (handler_test) добавить:
```go
func (m *MockAttachmentUseCase) MarkListened(id, userID uuid.UUID) (*domain.VoiceListened, error) {
	args := m.Called(id, userID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*domain.VoiceListened), args.Error(1)
}
```
Тесты:
```go
func newListenRequest(t *testing.T, id string, userID uuid.UUID) *http.Request {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/attachments/"+id+"/listen", nil)
	req.SetPathValue("id", id)
	return req.WithContext(context.WithValue(req.Context(), "user_id", userID))
}

func TestMarkListenedNotifiesAndReturns204(t *testing.T) {
	id, userID := uuid.New(), uuid.New()
	ev := &domain.VoiceListened{ChannelID: uuid.New(), MessageID: uuid.New(), AttachmentID: id, UserID: userID}
	uc := new(MockAttachmentUseCase)
	uc.On("MarkListened", id, userID).Return(ev, nil)
	h := newAttachmentHandler(uc)
	var got *domain.VoiceListened
	h.SetVoiceListenedNotifier(func(e *domain.VoiceListened) { got = e })

	rec := httptest.NewRecorder()
	h.MarkListened(rec, newListenRequest(t, id.String(), userID))

	assert.Equal(t, http.StatusNoContent, rec.Code)
	assert.Equal(t, ev, got)
}

func TestMarkListenedWithoutEventDoesNotNotify(t *testing.T) {
	id, userID := uuid.New(), uuid.New()
	uc := new(MockAttachmentUseCase)
	uc.On("MarkListened", id, userID).Return(nil, nil)
	h := newAttachmentHandler(uc)
	called := false
	h.SetVoiceListenedNotifier(func(*domain.VoiceListened) { called = true })

	rec := httptest.NewRecorder()
	h.MarkListened(rec, newListenRequest(t, id.String(), userID))

	assert.Equal(t, http.StatusNoContent, rec.Code)
	assert.False(t, called)
}

func TestMarkListenedMapsNotFoundTo404(t *testing.T) {
	id, userID := uuid.New(), uuid.New()
	uc := new(MockAttachmentUseCase)
	uc.On("MarkListened", id, userID).Return(nil, domain.ErrAttachmentNotFound)
	rec := httptest.NewRecorder()
	newAttachmentHandler(uc).MarkListened(rec, newListenRequest(t, id.String(), userID))
	assert.Equal(t, http.StatusNotFound, rec.Code)
}
```

- [ ] **Step 3: Прогнать — падают (не компилируется)**

Run: `cd server && go vet ./internal/usecase/ ./internal/delivery/http/handler/`
Expected: `MarkListened undefined`.

- [ ] **Step 4: Реализация**

`domain/attachment.go`, в `AttachmentUseCase`:
```go
	// MarkListened отмечает, что userID начал слушать голосовое. Событие
	// возвращается только при первой записи не-автора — его и шлют в WS.
	MarkListened(id, userID uuid.UUID) (*VoiceListened, error)
```
`usecase/attachment.go`:
```go
func (uc *attachmentUseCase) MarkListened(id, userID uuid.UUID) (*domain.VoiceListened, error) {
	att, err := uc.repo.GetByID(id)
	if err != nil {
		return nil, err
	}
	// Черновик (ещё не в сообщении) и не-голосовое прослушанными не бывают.
	if !att.IsVoice || att.MessageID == nil {
		return nil, domain.ErrAttachmentNotFound
	}
	// Как GetForUser: без права на канал — «не найдено», чтобы не
	// подтверждать существование вложения постороннему.
	if _, err := uc.requirePermission(att.ChannelID, userID, domain.PermViewChannels); err != nil {
		return nil, domain.ErrAttachmentNotFound
	}
	// Прослушивание автором не считается (spec §1.5) и не пишется.
	if att.UserID == userID {
		return nil, nil
	}
	inserted, err := uc.repo.MarkListened(id, userID)
	if err != nil {
		return nil, fmt.Errorf("mark listened: %w", err)
	}
	if !inserted {
		return nil, nil
	}
	return &domain.VoiceListened{ChannelID: att.ChannelID, MessageID: *att.MessageID, AttachmentID: att.ID, UserID: userID}, nil
}
```
`handler/attachment.go`: поле `onListened func(*domain.VoiceListened)` в `AttachmentHandler`, и:
```go
// SetVoiceListenedNotifier — доставка события «прослушано» (main.go шлёт его
// в хаб участникам канала). Отдельный сеттер, а не зависимость конструктора:
// хендлер вложений не знает о WS, как и раньше.
func (h *AttachmentHandler) SetVoiceListenedNotifier(f func(*domain.VoiceListened)) { h.onListened = f }

func (h *AttachmentHandler) MarkListened(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidAttachmentID, "invalid attachment id")
		return
	}
	ev, err := h.uc.MarkListened(id, userID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	if ev != nil && h.onListened != nil {
		h.onListened(ev)
	}
	w.WriteHeader(http.StatusNoContent)
}
```
`cmd/api/main.go` — после создания `attachmentHandler` (строка ~259):
```go
	attachmentHandler.SetVoiceListenedNotifier(func(ev *domain.VoiceListened) {
		payload, _ := json.Marshal(ev)
		hub.SendToChannel(ev.ChannelID, &ws.Message{Type: "voice_listened", Payload: payload})
	})
```
и маршрут рядом с остальными вложениями:
```go
	router.HandleFunc("POST /api/v1/attachments/{id}/listen", authMid.RequireAuth(attachmentHandler.MarkListened))
```
(Проверить импорты `encoding/json`, `domain`, `ws` в main.go — скорее всего уже есть.)

- [ ] **Step 5: Прогнать**

Run: `make test && make vet && (cd server && gofmt -l ./internal ./cmd ./pkg)`
Expected: exit 0, gofmt ничего не печатает.

- [ ] **Step 6: Commit**
```bash
git add server/internal/domain/attachment.go server/internal/usecase/attachment.go server/internal/usecase/attachment_test.go \
  server/internal/delivery/http/handler/attachment.go server/internal/delivery/http/handler/attachment_test.go server/cmd/api/main.go
git commit -m "VYC-101 server: эндпоинт прослушивания голосового и WS voice_listened"
```

---

### Task 6: Клиент — типы, API, i18n

**Files:**
- Modify: `client/src/types/index.ts`, `client/src/services/api.ts`, `client/src/i18n/locales/ru.ts`, `client/src/i18n/locales/en.ts`
- Test: `client/src/services/__tests__/api.voice.test.ts`

**Interfaces:**
- Produces:
  - `Attachment` + `is_voice?: boolean; duration_ms?: number; waveform?: string /* base64, 64 байта */; listened?: boolean`
  - `apiService.uploadAttachment(channelId, file, opts: { onProgress?; voice?: { durationMs: number; waveform: number[] } })`
  - `apiService.markVoiceListened(attachmentId: string): Promise<void>`
  - i18n namespace `voice.*` (ключи ниже), `errors.voice_invalid`, `errors.voice_message_invalid`
  - `voice/waveform.ts`: `waveformToBase64(values: number[]): string`, `waveformFromBase64(b64: string | undefined): number[]` — создаются здесь (нужны api)

- [ ] **Step 1: Падающий тест**

`client/src/services/__tests__/api.voice.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { waveformToBase64, waveformFromBase64 } from '@/voice/waveform';

describe('waveform base64', () => {
  it('кодирует 64 значения 0–255 и декодирует обратно', () => {
    const values = Array.from({ length: 64 }, (_, i) => (i * 4) % 256);
    const b64 = waveformToBase64(values);
    expect(atob(b64)).toHaveLength(64);
    expect(waveformFromBase64(b64)).toEqual(values);
  });

  it('зажимает значения вне 0–255 и дробные', () => {
    expect(waveformFromBase64(waveformToBase64([-5, 300, 12.7]))).toEqual([0, 255, 13]);
  });

  it('пустое/битое → пустой массив, без исключения', () => {
    expect(waveformFromBase64(undefined)).toEqual([]);
    expect(waveformFromBase64('%%%')).toEqual([]);
  });
});
```
Run: `cd client && npx vitest run src/services/__tests__/api.voice.test.ts` → FAIL (модуля нет).

- [ ] **Step 2: `client/src/voice/waveform.ts` (кодек)**
```ts
/** Волна голосового: 64 значения 0–255 (контракт сервера, миграция 027). */
export const WAVEFORM_LEN = 64;

const clampByte = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

export function waveformToBase64(values: number[]): string {
  return btoa(String.fromCharCode(...values.map(clampByte)));
}

export function waveformFromBase64(b64: string | undefined): number[] {
  if (!b64) return [];
  try {
    return Array.from(atob(b64), (c) => c.charCodeAt(0));
  } catch {
    return [];
  }
}
```
Run тот же тест → PASS.

- [ ] **Step 3: Типы и API**

`types/index.ts`, в `Attachment` после `thumb_url`:
```ts
  /** Голосовое сообщение (VYC-101). Остальные поля ниже есть только у него. */
  is_voice?: boolean;
  duration_ms?: number;
  /** base64 от 64 байт 0–255 — см. voice/waveform.ts. */
  waveform?: string;
  /** Для автора — «слушал кто-то», для остальных — «слушал я». У гостей нет. */
  listened?: boolean;
```
`services/api.ts`, в `uploadAttachment`: тип `opts: { onProgress?: (percent: number) => void; voice?: { durationMs: number; waveform: number[] } }`; после `form.append('channel_id', channelId);` и **до** `form.append('file', …)`:
```ts
      if (opts.voice) {
        form.append('voice', '1');
        form.append('duration_ms', String(Math.round(opts.voice.durationMs)));
        form.append('waveform', waveformToBase64(opts.voice.waveform));
      }
```
(импорт `waveformToBase64` из `@/voice/waveform`). После `getAttachment`:
```ts
  /** Отметка «начал слушать голосовое». Идемпотентна на сервере. */
  async markVoiceListened(attachmentId: string): Promise<void> {
    await this.request(`/api/v1/attachments/${attachmentId}/listen`, { method: 'POST' });
  }
```
(Если `request` падает на пустом теле 204 — посмотреть, как это решено у `deleteAttachment` (DELETE → 204) и повторить.)

- [ ] **Step 4: i18n**

В `ru.ts` новый namespace (рядом с `chat`):
```ts
  voice: {
    record: 'Записать голосовое сообщение',
    recordKeyboardHint: 'Удерживайте, чтобы записать. Enter — записать без удержания',
    slideToCancel: '‹ Отмена',
    lockHint: 'Потяните вверх, чтобы закрепить',
    recording: 'Идёт запись',
    deleteRecording: 'Удалить запись',
    sendRecording: 'Отправить запись',
    hintHold: 'Удерживайте, чтобы записать',
    hintCall: 'Нельзя записать голосовое во время звонка',
    hintInterrupted: 'Запись прервана',
    micDenied: 'Нет доступа к микрофону. Разрешите его в настройках',
    micNotFound: 'Микрофон не найден',
    micFailed: 'Не удалось начать запись',
    message: 'Голосовое сообщение',
    play: 'Воспроизвести голосовое сообщение',
    pause: 'Пауза',
    position: 'Позиция в голосовом сообщении',
    speed: 'Скорость воспроизведения: {{rate}}',
    unlistened: 'Не прослушано',
  },
```
В `errors`:
```ts
    voice_invalid: 'Не удалось отправить голосовое сообщение',
    voice_message_invalid: 'Голосовое сообщение не может содержать текст или другие вложения',
```
В `en.ts` те же ключи:
```ts
  voice: {
    record: 'Record a voice message',
    recordKeyboardHint: 'Hold to record. Enter records without holding',
    slideToCancel: '‹ Cancel',
    lockHint: 'Slide up to lock',
    recording: 'Recording',
    deleteRecording: 'Delete recording',
    sendRecording: 'Send recording',
    hintHold: 'Hold to record',
    hintCall: "You can't record a voice message during a call",
    hintInterrupted: 'Recording interrupted',
    micDenied: 'No microphone access. Allow it in settings',
    micNotFound: 'No microphone found',
    micFailed: "Couldn't start recording",
    message: 'Voice message',
    play: 'Play voice message',
    pause: 'Pause',
    position: 'Voice message position',
    speed: 'Playback speed: {{rate}}',
    unlistened: 'Not listened',
  },
```
и `voice_invalid: "Couldn't send the voice message"`, `voice_message_invalid: 'A voice message cannot contain text or other attachments'`.

- [ ] **Step 5: Гейты**

Run (из `client/`): `npx tsc --noEmit > /tmp/tsc.txt 2>&1; echo $?; wc -c < /tmp/tsc.txt` → `0` и `0`. `npm run check:i18n` → «непереведённых строк не найдено.»

- [ ] **Step 6: Commit**
```bash
git add client/src/types/index.ts client/src/services/api.ts client/src/voice/waveform.ts \
  client/src/services/__tests__/api.voice.test.ts client/src/i18n/locales/ru.ts client/src/i18n/locales/en.ts
git commit -m "VYC-101 client: типы, API и строки голосовых"
```

---

### Task 7: State machine жеста (TDD)

**Files:**
- Create: `client/src/voice/voiceGesture.ts`
- Test: `client/src/voice/__tests__/voiceGesture.test.ts`

**Interfaces:**
- Produces (точные имена):
```ts
export const LOCK_DY = 60, CANCEL_DX = 100, MIN_MS = 1000, MAX_MS = 900_000;
export type RecorderFailure = 'mic_denied' | 'mic_not_found' | 'mic_failed';
export type HintKind = 'hold' | 'call' | 'interrupted' | RecorderFailure;
export interface Point { x: number; y: number }
export type GestureState =
  | { kind: 'idle' }
  | { kind: 'starting'; origin: Point | null; keyboard: boolean }
  | { kind: 'recording'; origin: Point; startedAt: number; dx: number }
  | { kind: 'locked'; startedAt: number };
export type GestureEvent =
  | { type: 'press'; x: number; y: number; inCall: boolean }
  | { type: 'keyboardStart'; inCall: boolean }
  | { type: 'move'; x: number; y: number }
  | { type: 'release'; t: number }
  | { type: 'interrupt' }
  | { type: 'recorderStarted'; t: number }
  | { type: 'recorderFailed'; reason: RecorderFailure }
  | { type: 'tick'; t: number }
  | { type: 'lockedSend'; t: number }
  | { type: 'lockedDelete' };
export type GestureEffect =
  | { type: 'startRecorder' } | { type: 'send' } | { type: 'discard' } | { type: 'hint'; hint: HintKind };
export const IDLE: GestureState;
export function reduce(state: GestureState, event: GestureEvent): { state: GestureState; effects: GestureEffect[] };
```

- [ ] **Step 1: Падающие тесты**

`client/src/voice/__tests__/voiceGesture.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { reduce, IDLE, LOCK_DY, CANCEL_DX, MIN_MS, MAX_MS, type GestureState, type GestureEvent } from '@/voice/voiceGesture';

function run(events: GestureEvent[], from: GestureState = IDLE) {
  let state = from;
  const effects = [];
  for (const e of events) {
    const r = reduce(state, e);
    state = r.state;
    effects.push(...r.effects);
  }
  return { state, effects };
}

const press = { type: 'press', x: 100, y: 100, inCall: false } as const;
const started = { type: 'recorderStarted', t: 0 } as const;

describe('voiceGesture', () => {
  it('press запускает рекордер', () => {
    expect(run([press])).toEqual({ state: { kind: 'starting', origin: { x: 100, y: 100 }, keyboard: false }, effects: [{ type: 'startRecorder' }] });
  });

  it('press во время звонка — подсказка, запись не стартует', () => {
    expect(run([{ ...press, inCall: true }])).toEqual({ state: IDLE, effects: [{ type: 'hint', hint: 'call' }] });
  });

  it('отпустил до старта рекордера (короткий клик) — discard + hold', () => {
    const r = run([press, { type: 'release', t: 50 }]);
    expect(r.state).toEqual(IDLE);
    expect(r.effects).toEqual([{ type: 'startRecorder' }, { type: 'discard' }, { type: 'hint', hint: 'hold' }]);
  });

  it('удержание ≥ MIN_MS и отпускание — send', () => {
    const r = run([press, started, { type: 'release', t: MIN_MS }]);
    expect(r.state).toEqual(IDLE);
    expect(r.effects.at(-1)).toEqual({ type: 'send' });
  });

  it('удержание < MIN_MS — discard + hold', () => {
    const r = run([press, started, { type: 'release', t: MIN_MS - 1 }]);
    expect(r.effects.slice(-2)).toEqual([{ type: 'discard' }, { type: 'hint', hint: 'hold' }]);
  });

  it('свайп вверх за порог — locked, release игнорируется', () => {
    const r = run([press, started, { type: 'move', x: 100, y: 100 - LOCK_DY }, { type: 'release', t: 5000 }]);
    expect(r.state).toEqual({ kind: 'locked', startedAt: 0 });
    expect(r.effects).toEqual([{ type: 'startRecorder' }]);
  });

  it('свайп влево за порог — discard сразу, до отпускания', () => {
    const r = run([press, started, { type: 'move', x: 100 - CANCEL_DX, y: 100 }]);
    expect(r.state).toEqual(IDLE);
    expect(r.effects.at(-1)).toEqual({ type: 'discard' });
  });

  it('оба порога одним событием — отмена приоритетнее', () => {
    const r = run([press, started, { type: 'move', x: 100 - CANCEL_DX, y: 100 - LOCK_DY }]);
    expect(r.state).toEqual(IDLE);
    expect(r.effects.at(-1)).toEqual({ type: 'discard' });
  });

  it('move до порога обновляет dx (только влево, не положительный)', () => {
    expect(run([press, started, { type: 'move', x: 70, y: 100 }]).state).toMatchObject({ kind: 'recording', dx: -30 });
    expect(run([press, started, { type: 'move', x: 150, y: 100 }]).state).toMatchObject({ kind: 'recording', dx: 0 });
  });

  it('tick на MAX_MS отправляет из recording и из locked', () => {
    expect(run([press, started, { type: 'tick', t: MAX_MS }]).effects.at(-1)).toEqual({ type: 'send' });
    expect(run([{ type: 'tick', t: MAX_MS }], { kind: 'locked', startedAt: 0 }).effects).toEqual([{ type: 'send' }]);
    expect(run([{ type: 'tick', t: MAX_MS - 1 }], { kind: 'locked', startedAt: 0 }).effects).toEqual([]);
  });

  it('interrupt при удержании — discard + interrupted; в locked — игнор', () => {
    expect(run([press, started, { type: 'interrupt' }]).effects.slice(-2)).toEqual([{ type: 'discard' }, { type: 'hint', hint: 'interrupted' }]);
    expect(run([press, { type: 'interrupt' }]).state).toEqual(IDLE);
    const locked: GestureState = { kind: 'locked', startedAt: 0 };
    expect(run([{ type: 'interrupt' }], locked)).toEqual({ state: locked, effects: [] });
  });

  it('recorderFailed — idle + подсказка с причиной', () => {
    expect(run([press, { type: 'recorderFailed', reason: 'mic_denied' }])).toEqual({
      state: IDLE, effects: [{ type: 'startRecorder' }, { type: 'hint', hint: 'mic_denied' }],
    });
  });

  it('клавиатура: keyboardStart → starting(keyboard) → locked', () => {
    const r = run([{ type: 'keyboardStart', inCall: false }, { type: 'recorderStarted', t: 10 }]);
    expect(r.state).toEqual({ kind: 'locked', startedAt: 10 });
  });

  it('клавиатура в звонке — подсказка', () => {
    expect(run([{ type: 'keyboardStart', inCall: true }]).effects).toEqual([{ type: 'hint', hint: 'call' }]);
  });

  it('locked: send (≥ MIN_MS), delete, короткий send → hold', () => {
    const locked: GestureState = { kind: 'locked', startedAt: 0 };
    expect(run([{ type: 'lockedSend', t: MIN_MS }], locked)).toEqual({ state: IDLE, effects: [{ type: 'send' }] });
    expect(run([{ type: 'lockedDelete' }], locked)).toEqual({ state: IDLE, effects: [{ type: 'discard' }] });
    expect(run([{ type: 'lockedSend', t: 10 }], locked).effects).toEqual([{ type: 'discard' }, { type: 'hint', hint: 'hold' }]);
  });

  it('посторонние события в idle ничего не делают', () => {
    for (const e of [{ type: 'release', t: 1 }, { type: 'move', x: 0, y: 0 }, { type: 'interrupt' }, { type: 'tick', t: MAX_MS }, { type: 'recorderStarted', t: 0 }] as GestureEvent[]) {
      expect(run([e])).toEqual({ state: IDLE, effects: [] });
    }
  });

  it('повторный press во время записи игнорируется', () => {
    const s = run([press, started]).state;
    expect(run([press], s)).toEqual({ state: s, effects: [] });
  });
});
```
Run: `cd client && npx vitest run src/voice/__tests__/voiceGesture.test.ts` → FAIL (модуля нет).

- [ ] **Step 2: Реализация `client/src/voice/voiceGesture.ts`**
```ts
/**
 * Жест голосового (VYC-101, spec §2.1) — чистая state machine без React и DOM.
 * Хук useVoiceRecording переводит pointer/keyboard/window-события в события
 * этой машины и исполняет возвращённые эффекты.
 */
export const LOCK_DY = 60;
export const CANCEL_DX = 100;
export const MIN_MS = 1000;
export const MAX_MS = 900_000;

// … типы ровно как в блоке Interfaces выше …

export const IDLE: GestureState = { kind: 'idle' };

const none = (state: GestureState) => ({ state, effects: [] as GestureEffect[] });
const to = (state: GestureState, ...effects: GestureEffect[]) => ({ state, effects });
const hint = (h: HintKind): GestureEffect => ({ type: 'hint', hint: h });

export function reduce(state: GestureState, event: GestureEvent): { state: GestureState; effects: GestureEffect[] } {
  switch (state.kind) {
    case 'idle':
      if (event.type === 'press') {
        if (event.inCall) return to(IDLE, hint('call'));
        return to({ kind: 'starting', origin: { x: event.x, y: event.y }, keyboard: false }, { type: 'startRecorder' });
      }
      if (event.type === 'keyboardStart') {
        if (event.inCall) return to(IDLE, hint('call'));
        return to({ kind: 'starting', origin: null, keyboard: true }, { type: 'startRecorder' });
      }
      return none(state);

    case 'starting':
      switch (event.type) {
        case 'recorderStarted':
          return state.keyboard || !state.origin
            ? none({ kind: 'locked', startedAt: event.t })
            : none({ kind: 'recording', origin: state.origin, startedAt: event.t, dx: 0 });
        case 'recorderFailed':
          return to(IDLE, hint(event.reason));
        case 'release':
          // Клавиатурный старт release не получает; для указателя это
          // короткий клик или отпускание во время запроса разрешения.
          return state.keyboard ? none(state) : to(IDLE, { type: 'discard' }, hint('hold'));
        case 'interrupt':
          return to(IDLE, { type: 'discard' }, hint('interrupted'));
        default:
          return none(state);
      }

    case 'recording':
      switch (event.type) {
        case 'move': {
          const dx = event.x - state.origin.x;
          const dy = event.y - state.origin.y;
          if (dx <= -CANCEL_DX) return to(IDLE, { type: 'discard' });
          if (dy <= -LOCK_DY) return none({ kind: 'locked', startedAt: state.startedAt });
          return none({ ...state, dx: Math.min(0, dx) });
        }
        case 'release':
          return event.t - state.startedAt < MIN_MS
            ? to(IDLE, { type: 'discard' }, hint('hold'))
            : to(IDLE, { type: 'send' });
        case 'tick':
          return event.t - state.startedAt >= MAX_MS ? to(IDLE, { type: 'send' }) : none(state);
        case 'interrupt':
          return to(IDLE, { type: 'discard' }, hint('interrupted'));
        case 'recorderFailed':
          return to(IDLE, hint(event.reason));
        default:
          return none(state);
      }

    case 'locked':
      switch (event.type) {
        case 'tick':
          return event.t - state.startedAt >= MAX_MS ? to(IDLE, { type: 'send' }) : none(state);
        case 'lockedSend':
          return event.t - state.startedAt < MIN_MS
            ? to(IDLE, { type: 'discard' }, hint('hold'))
            : to(IDLE, { type: 'send' });
        case 'lockedDelete':
          return to(IDLE, { type: 'discard' });
        case 'recorderFailed':
          return to(IDLE, hint(event.reason));
        default:
          // interrupt и release в закреплённой записи игнорируются намеренно.
          return none(state);
      }
  }
}
```

- [ ] **Step 3: Прогнать — PASS**

Run: `npx vitest run src/voice/__tests__/voiceGesture.test.ts` → все PASS.

- [ ] **Step 4: Commit**
```bash
git add client/src/voice/voiceGesture.ts client/src/voice/__tests__/voiceGesture.test.ts
git commit -m "VYC-101 client: state machine жеста записи"
```

---

### Task 8: Рекордер и волна

**Files:**
- Modify: `client/src/voice/waveform.ts`
- Create: `client/src/voice/voiceRecorder.ts`
- Test: `client/src/voice/__tests__/waveform.test.ts`, `client/src/voice/__tests__/voiceRecorder.test.ts`

**Interfaces:**
- Consumes: `buildMicConstraints()` (`services/mediaDevices.ts`), `getDeniedMediaKinds` (`services/mediaPermissions.ts`), `MIN_MS`, `MAX_MS`, `RecorderFailure` (Task 7).
- Produces:
```ts
// waveform.ts
export function downsampleWaveform(peaks: number[], len?: number /* = WAVEFORM_LEN */): number[];
// voiceRecorder.ts
export interface VoiceRecording { blob: Blob; mimeType: string; durationMs: number; waveform: number[] }
export interface VoiceRecorderHandle { level(): number /* 0..1 */; stop(): Promise<VoiceRecording>; discard(): void }
export class VoiceRecorderError extends Error { constructor(public reason: RecorderFailure) }
export interface RecorderDeps {
  getUserMedia(c: MediaStreamConstraints): Promise<MediaStream>;
  createRecorder(stream: MediaStream, mimeType: string): MediaRecorder;
  isTypeSupported(type: string): boolean;
  createAudioContext(): AudioContext;
  now(): number;
  micDenied(): Promise<boolean>;
}
export function pickMimeType(isTypeSupported: (t: string) => boolean): string;
export function voiceFileName(mimeType: string): string; // voice.weba | voice.ogg | voice.m4a
export function toRecorderFailure(err: unknown): RecorderFailure;
export function startVoiceRecorder(deps?: Partial<RecorderDeps>): Promise<VoiceRecorderHandle>;
```

- [ ] **Step 1: Падающие тесты волны**

`client/src/voice/__tests__/waveform.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { downsampleWaveform, WAVEFORM_LEN } from '@/voice/waveform';

describe('downsampleWaveform', () => {
  it('всегда ровно 64 значения 0–255', () => {
    const out = downsampleWaveform(Array.from({ length: 1000 }, (_, i) => Math.sin(i) ** 2));
    expect(out).toHaveLength(WAVEFORM_LEN);
    expect(Math.max(...out)).toBe(255);
    expect(out.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)).toBe(true);
  });

  it('берёт максимум в бакете', () => {
    const peaks = new Array(128).fill(0);
    peaks[1] = 1;
    const out = downsampleWaveform(peaks);
    expect(out[0]).toBe(255);
    expect(out[1]).toBe(0);
  });

  it('тишина и пустой вход — нули, без NaN', () => {
    expect(downsampleWaveform(new Array(200).fill(0))).toEqual(new Array(64).fill(0));
    expect(downsampleWaveform([])).toEqual(new Array(64).fill(0));
  });

  it('меньше 64 точек растягивается', () => {
    const out = downsampleWaveform([0, 1]);
    expect(out).toHaveLength(64);
    expect(out[0]).toBe(0);
    expect(out[63]).toBe(255);
  });
});
```

- [ ] **Step 2: Реализация `downsampleWaveform`** (дописать в `waveform.ts`)
```ts
/**
 * Сжимает пики, снятые каждые ~100 мс, до WAVEFORM_LEN столбиков: максимум
 * в бакете, нормализация к 0–255 по максимуму записи. Тишина даёт нули —
 * без деления на ноль.
 */
export function downsampleWaveform(peaks: number[], len = WAVEFORM_LEN): number[] {
  if (peaks.length === 0) return new Array(len).fill(0);
  const buckets = Array.from({ length: len }, (_, i) => {
    const from = Math.floor((i * peaks.length) / len);
    const to = Math.max(from + 1, Math.floor(((i + 1) * peaks.length) / len));
    let max = 0;
    for (let j = from; j < to && j < peaks.length; j++) max = Math.max(max, peaks[j]);
    return max;
  });
  const top = Math.max(...buckets);
  if (top <= 0) return new Array(len).fill(0);
  return buckets.map((v) => clampByte((v / top) * 255));
}
```
Run: `npx vitest run src/voice/__tests__/waveform.test.ts` → PASS.

- [ ] **Step 3: Падающие тесты рекордера**

`client/src/voice/__tests__/voiceRecorder.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { pickMimeType, voiceFileName, toRecorderFailure, startVoiceRecorder, VoiceRecorderError, type RecorderDeps } from '@/voice/voiceRecorder';

function fakeTrack() { return { stop: vi.fn(), kind: 'audio' }; }

function fakeDeps(over: Partial<RecorderDeps> = {}) {
  const track = fakeTrack();
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
  const ctxClose = vi.fn(() => Promise.resolve());
  let clock = 0;
  const recorder = {
    state: 'inactive',
    mimeType: 'audio/webm;codecs=opus',
    ondataavailable: null as null | ((e: { data: Blob }) => void),
    onstop: null as null | (() => void),
    start: vi.fn(function (this: { state: string }) { this.state = 'recording'; }),
    stop: vi.fn(function (this: { state: string; ondataavailable: ((e: { data: Blob }) => void) | null; onstop: (() => void) | null }) {
      this.state = 'inactive';
      this.ondataavailable?.({ data: new Blob(['x'], { type: 'audio/webm' }) });
      this.onstop?.();
    }),
  };
  const deps: RecorderDeps = {
    getUserMedia: vi.fn(async () => stream),
    createRecorder: vi.fn(() => recorder as unknown as MediaRecorder),
    isTypeSupported: (t) => t.startsWith('audio/webm'),
    createAudioContext: () => ({
      createMediaStreamSource: () => ({ connect: vi.fn(), disconnect: vi.fn() }),
      createAnalyser: () => ({ fftSize: 0, getFloatTimeDomainData: (a: Float32Array) => a.fill(0.5) }),
      close: ctxClose,
    }) as unknown as AudioContext,
    now: () => clock,
    micDenied: async () => false,
    ...over,
  };
  return { deps, track, ctxClose, recorder, advance: (ms: number) => { clock += ms; } };
}

describe('pickMimeType / voiceFileName', () => {
  it('opus/webm первым, затем ogg, затем mp4, иначе пусто', () => {
    expect(pickMimeType(() => true)).toBe('audio/webm;codecs=opus');
    expect(pickMimeType((t) => t.startsWith('audio/ogg'))).toBe('audio/ogg;codecs=opus');
    expect(pickMimeType((t) => t === 'audio/mp4')).toBe('audio/mp4');
    expect(pickMimeType(() => false)).toBe('');
  });
  it('имя по mime', () => {
    expect(voiceFileName('audio/webm;codecs=opus')).toBe('voice.weba');
    expect(voiceFileName('audio/ogg;codecs=opus')).toBe('voice.ogg');
    expect(voiceFileName('audio/mp4')).toBe('voice.m4a');
    expect(voiceFileName('')).toBe('voice.weba');
  });
});

describe('toRecorderFailure', () => {
  it('маппит DOMException', () => {
    expect(toRecorderFailure(new DOMException('x', 'NotAllowedError'))).toBe('mic_denied');
    expect(toRecorderFailure(new DOMException('x', 'NotFoundError'))).toBe('mic_not_found');
    expect(toRecorderFailure(new Error('boom'))).toBe('mic_failed');
  });
});

describe('startVoiceRecorder', () => {
  it('stop возвращает запись и освобождает трек и контекст', async () => {
    const f = fakeDeps();
    const h = await startVoiceRecorder(f.deps);
    f.advance(4200);
    const rec = await h.stop();
    expect(rec.durationMs).toBe(4200);
    expect(rec.waveform).toHaveLength(64);
    expect(rec.blob.size).toBeGreaterThan(0);
    expect(f.track.stop).toHaveBeenCalled();
    expect(f.ctxClose).toHaveBeenCalled();
  });

  it('длительность зажимается в [1000, 900000]', async () => {
    const f = fakeDeps();
    const h = await startVoiceRecorder(f.deps);
    f.advance(2_000_000);
    expect((await h.stop()).durationMs).toBe(900_000);
  });

  it('discard освобождает трек и контекст, повтор безопасен', async () => {
    const f = fakeDeps();
    const h = await startVoiceRecorder(f.deps);
    h.discard();
    h.discard();
    expect(f.track.stop).toHaveBeenCalledTimes(1);
    expect(f.ctxClose).toHaveBeenCalledTimes(1);
  });

  it('ошибка MediaRecorder после getUserMedia — трек освобождён, ошибка mic_failed', async () => {
    const f = fakeDeps({ createRecorder: () => { throw new Error('no codec'); } });
    await expect(startVoiceRecorder(f.deps)).rejects.toMatchObject({ reason: 'mic_failed' });
    expect(f.track.stop).toHaveBeenCalled();
  });

  it('OverconstrainedError — повтор с audio: true', async () => {
    const f = fakeDeps();
    const gum = vi.fn()
      .mockRejectedValueOnce(new DOMException('x', 'OverconstrainedError'))
      .mockImplementation(f.deps.getUserMedia);
    const h = await startVoiceRecorder({ ...f.deps, getUserMedia: gum });
    expect(gum).toHaveBeenLastCalledWith({ audio: true });
    h.discard();
  });

  it('mac TCC запрет — mic_denied без getUserMedia', async () => {
    const f = fakeDeps({ micDenied: async () => true });
    await expect(startVoiceRecorder(f.deps)).rejects.toBeInstanceOf(VoiceRecorderError);
    expect(f.deps.getUserMedia).not.toHaveBeenCalled();
  });
});
```
Run → FAIL.

- [ ] **Step 4: Реализация `client/src/voice/voiceRecorder.ts`**
```ts
import { buildMicConstraints } from '@/services/mediaDevices';
import { getDeniedMediaKinds } from '@/services/mediaPermissions';
import { downsampleWaveform } from './waveform';
import { MAX_MS, MIN_MS, type RecorderFailure } from './voiceGesture';

/** 32 кбит/с: 15 минут ≈ 3.6 МБ — далеко от лимита плана. */
const BITRATE = 32_000;
const PEAK_EVERY_MS = 100;
const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4'];

export interface VoiceRecording { blob: Blob; mimeType: string; durationMs: number; waveform: number[] }
export interface VoiceRecorderHandle { level(): number; stop(): Promise<VoiceRecording>; discard(): void }

export class VoiceRecorderError extends Error {
  constructor(public reason: RecorderFailure) { super(reason); }
}

export interface RecorderDeps {
  getUserMedia(c: MediaStreamConstraints): Promise<MediaStream>;
  createRecorder(stream: MediaStream, mimeType: string): MediaRecorder;
  isTypeSupported(type: string): boolean;
  createAudioContext(): AudioContext;
  now(): number;
  micDenied(): Promise<boolean>;
}

const browserDeps = (): RecorderDeps => ({
  getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
  createRecorder: (stream, mimeType) =>
    new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: BITRATE }),
  isTypeSupported: (t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t),
  createAudioContext: () => new AudioContext(),
  now: () => performance.now(),
  micDenied: async () => {
    const api = (window as Window & typeof globalThis).electronAPI;
    return (await getDeniedMediaKinds(api)).microphoneDenied;
  },
});

export function pickMimeType(isTypeSupported: (t: string) => boolean): string {
  return MIME_CANDIDATES.find((t) => isTypeSupported(t)) ?? '';
}

/** Имя — подсказка; окончательное имя голосового выбирает сервер по контейнеру. */
export function voiceFileName(mimeType: string): string {
  if (mimeType.startsWith('audio/ogg')) return 'voice.ogg';
  if (mimeType.startsWith('audio/mp4')) return 'voice.m4a';
  return 'voice.weba';
}

export function toRecorderFailure(err: unknown): RecorderFailure {
  if (err instanceof VoiceRecorderError) return err.reason;
  const name = err instanceof DOMException || err instanceof Error ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'mic_denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'mic_not_found';
  return 'mic_failed';
}

async function openMic(deps: RecorderDeps): Promise<MediaStream> {
  try {
    return await deps.getUserMedia({ audio: buildMicConstraints() });
  } catch (err) {
    // Выбранный микрофон пропал — как acquireUserMedia, падаем к системному.
    if (err instanceof DOMException && err.name === 'OverconstrainedError') {
      return deps.getUserMedia({ audio: true });
    }
    throw err;
  }
}

export async function startVoiceRecorder(over: Partial<RecorderDeps> = {}): Promise<VoiceRecorderHandle> {
  const deps = { ...browserDeps(), ...over };
  if (await deps.micDenied()) throw new VoiceRecorderError('mic_denied');

  let stream: MediaStream;
  try {
    stream = await openMic(deps);
  } catch (err) {
    throw new VoiceRecorderError(toRecorderFailure(err));
  }

  let ctx: AudioContext | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let released = false;
  // Единственная точка освобождения (spec §2.2): трек, контекст, таймер.
  const release = () => {
    if (released) return;
    released = true;
    if (timer) clearInterval(timer);
    stream.getTracks().forEach((t) => t.stop());
    void ctx?.close().catch(() => {});
  };

  try {
    const mimeType = pickMimeType(deps.isTypeSupported);
    const recorder = deps.createRecorder(stream, mimeType);
    ctx = deps.createAudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);

    const sample = () => {
      analyser.getFloatTimeDomainData(buf);
      let peak = 0;
      let sum = 0;
      for (const v of buf) { peak = Math.max(peak, Math.abs(v)); sum += v * v; }
      return { peak, rms: Math.sqrt(sum / buf.length) };
    };
    const peaks: number[] = [];
    timer = setInterval(() => peaks.push(sample().peak), PEAK_EVERY_MS);

    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    const startedAt = deps.now();
    recorder.start(1000);

    return {
      level: () => (released ? 0 : Math.min(1, sample().rms * 4)),
      stop: () => new Promise<VoiceRecording>((resolve) => {
        const durationMs = Math.min(MAX_MS, Math.max(MIN_MS, Math.round(deps.now() - startedAt)));
        if (peaks.length === 0) peaks.push(sample().peak);
        recorder.onstop = () => {
          release();
          const type = recorder.mimeType || mimeType || 'audio/webm';
          resolve({ blob: new Blob(chunks, { type }), mimeType: type, durationMs, waveform: downsampleWaveform(peaks) });
        };
        if (recorder.state === 'inactive') recorder.onstop(new Event('stop'));
        else recorder.stop();
      }),
      discard: () => {
        if (recorder.state !== 'inactive') {
          recorder.ondataavailable = null;
          recorder.onstop = null;
          recorder.stop();
        }
        release();
      },
    };
  } catch (err) {
    release();
    throw new VoiceRecorderError(toRecorderFailure(err));
  }
}
```
(`toRecorderFailure(new Error('no codec'))` → `mic_failed` — нужное поведение для ошибки кодека. Если TS ругается на `recorder.onstop(new Event('stop'))` — вызвать сохранённую функцию `finish()` напрямую вместо `onstop`.)

- [ ] **Step 5: Прогнать**

Run: `npx vitest run src/voice/` → PASS; `npx tsc --noEmit` → 0 байт.

- [ ] **Step 6: Commit**
```bash
git add client/src/voice/waveform.ts client/src/voice/voiceRecorder.ts \
  client/src/voice/__tests__/waveform.test.ts client/src/voice/__tests__/voiceRecorder.test.ts
git commit -m "VYC-101 client: рекордер голосового с единым освобождением"
```

---

### Task 9: Оптимистичная отправка, retry, discard

**Files:**
- Create: `client/src/voice/sendVoice.ts`
- Modify: `client/src/stores/messageStore.ts`, `client/src/components/ChatArea.tsx`
- Test: `client/src/voice/__tests__/sendVoice.test.ts`

**Interfaces:**
- Consumes: `VoiceRecording`, `voiceFileName` (Task 8); `waveformToBase64` (Task 6); `apiService.uploadAttachment(…, { voice })`, `apiService.createMessage`, `apiService.deleteAttachment`.
- Produces:
```ts
// messageStore.ts
export interface PendingVoice { blob: Blob; objectUrl: string; mimeType: string; durationMs: number; waveform: number[]; attachment?: Attachment }
export type ChatMessage = Message & { deliveryState?: 'sending' | 'failed'; pendingVoice?: PendingVoice };
// sendVoice.ts
export interface VoiceStore { add(m: ChatMessage): void; update(id: string, patch: Partial<ChatMessage>): void; replace(id: string, m: ChatMessage): void; has(id: string): boolean }
export interface SendVoiceDeps {
  upload(channelId: string, file: File, voice: { durationMs: number; waveform: number[] }): Promise<Attachment>;
  createMessage(channelId: string, attachmentId: string): Promise<Message>;
  deleteAttachment(id: string): Promise<unknown>;
  store: VoiceStore;
  createObjectURL(b: Blob): string;
  revokeObjectURL(url: string): void;
  onOrphanFailure(err: unknown): void;
}
export function buildPendingVoiceMessage(a: { tempId: string; channelId: string; userId: string; now: string; recording: VoiceRecording; objectUrl: string }): ChatMessage;
export function sendVoice(deps: SendVoiceDeps, a: { tempId: string; channelId: string; userId: string; now: string; recording: VoiceRecording }): Promise<void>;
export function retryVoice(deps: SendVoiceDeps, msg: ChatMessage): Promise<void>;
export function discardVoice(deps: Pick<SendVoiceDeps, 'deleteAttachment' | 'revokeObjectURL'>, msg: ChatMessage): void;
```
- Produces для ChatArea: `sendVoiceMessage(recording: VoiceRecording): void` — будет передан в Composer как `onSendVoice` (Task 13).

- [ ] **Step 1: Падающие тесты**

`client/src/voice/__tests__/sendVoice.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { sendVoice, retryVoice, discardVoice, type SendVoiceDeps } from '@/voice/sendVoice';
import type { ChatMessage } from '@/stores/messageStore';
import type { Attachment, Message } from '@/types';

const recording = { blob: new Blob(['a'], { type: 'audio/webm' }), mimeType: 'audio/webm', durationMs: 4200, waveform: new Array(64).fill(9) };
const serverAtt = { id: 'att-1', is_voice: true, kind: 'audio', url: '/u' } as Attachment;
const serverMsg = { id: 'msg-1', attachments: [serverAtt] } as Message;

function harness(over: Partial<SendVoiceDeps> = {}) {
  const rows = new Map<string, ChatMessage>();
  const deps: SendVoiceDeps = {
    upload: vi.fn(async () => serverAtt),
    createMessage: vi.fn(async () => serverMsg),
    deleteAttachment: vi.fn(async () => undefined),
    store: {
      add: (m) => rows.set(m.id, m),
      update: (id, p) => { const r = rows.get(id); if (r) rows.set(id, { ...r, ...p }); },
      replace: (id, m) => { rows.delete(id); rows.set(m.id, m); },
      has: (id) => rows.has(id),
    },
    createObjectURL: () => 'blob:1',
    revokeObjectURL: vi.fn(),
    onOrphanFailure: vi.fn(),
    ...over,
  };
  return { deps, rows };
}
const args = { tempId: 'pending-1', channelId: 'ch', userId: 'me', now: '2026-09-30T00:00:00Z', recording };

describe('sendVoice', () => {
  it('строка появляется сразу с локальным пузырём, затем заменяется серверной', async () => {
    const h = harness();
    let seenPending: ChatMessage | undefined;
    h.deps.upload = vi.fn(async () => { seenPending = h.rows.get('pending-1'); return serverAtt; });
    await sendVoice(h.deps, args);
    expect(seenPending?.deliveryState).toBe('sending');
    expect(seenPending?.attachments?.[0]).toMatchObject({ is_voice: true, url: 'blob:1', duration_ms: 4200, user_id: 'me' });
    expect(h.deps.upload).toHaveBeenCalledWith('ch', expect.any(File), { durationMs: 4200, waveform: recording.waveform });
    expect((vi.mocked(h.deps.upload).mock.calls[0][1] as File).name).toBe('voice.weba');
    expect(h.deps.createMessage).toHaveBeenCalledWith('ch', 'att-1');
    expect(h.rows.has('pending-1')).toBe(false);
    expect(h.rows.get('msg-1')).toBe(serverMsg);
    expect(h.deps.revokeObjectURL).toHaveBeenCalledWith('blob:1');
  });

  it('падение загрузки → failed без attachment', async () => {
    const h = harness({ upload: vi.fn(async () => { throw new Error('net'); }) });
    await sendVoice(h.deps, args);
    const row = h.rows.get('pending-1')!;
    expect(row.deliveryState).toBe('failed');
    expect(row.pendingVoice?.attachment).toBeUndefined();
    expect(h.deps.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('падение создания → failed с сохранённым attachment', async () => {
    const h = harness({ createMessage: vi.fn(async () => { throw new Error('500'); }) });
    await sendVoice(h.deps, args);
    expect(h.rows.get('pending-1')!.pendingVoice?.attachment?.id).toBe('att-1');
  });

  it('строки уже нет (ушли из канала) и упало — onOrphanFailure', async () => {
    const h = harness({ upload: vi.fn(async () => { throw new Error('net'); }) });
    h.deps.store.has = () => false;
    await sendVoice(h.deps, args);
    expect(h.deps.onOrphanFailure).toHaveBeenCalled();
  });

  it('строки уже нет, но успех — сообщение всё равно создано', async () => {
    const h = harness();
    h.deps.store.has = () => false;
    await sendVoice(h.deps, args);
    expect(h.deps.createMessage).toHaveBeenCalled();
    expect(h.deps.revokeObjectURL).toHaveBeenCalled();
  });
});

describe('retryVoice', () => {
  it('без attachment — загружает заново', async () => {
    const h = harness({ upload: vi.fn(async () => { throw new Error('net'); }) });
    await sendVoice(h.deps, args);
    h.deps.upload = vi.fn(async () => serverAtt);
    await retryVoice(h.deps, h.rows.get('pending-1')!);
    expect(h.deps.upload).toHaveBeenCalledTimes(1);
    expect(h.rows.get('msg-1')).toBe(serverMsg);
  });

  it('с attachment — только createMessage, без повторной загрузки', async () => {
    const h = harness({ createMessage: vi.fn(async () => { throw new Error('500'); }) });
    await sendVoice(h.deps, args);
    const upload = vi.mocked(h.deps.upload);
    upload.mockClear();
    h.deps.createMessage = vi.fn(async () => serverMsg);
    await retryVoice(h.deps, h.rows.get('pending-1')!);
    expect(upload).not.toHaveBeenCalled();
    expect(h.rows.get('msg-1')).toBe(serverMsg);
  });

  it('двойной клик по retry — одна отправка', async () => {
    const h = harness({ upload: vi.fn(async () => { throw new Error('net'); }) });
    await sendVoice(h.deps, args);
    h.deps.upload = vi.fn(async () => serverAtt);
    const row = h.rows.get('pending-1')!;
    await Promise.all([retryVoice(h.deps, row), retryVoice(h.deps, row)]);
    expect(h.deps.upload).toHaveBeenCalledTimes(1);
  });
});

describe('discardVoice', () => {
  it('освобождает URL и удаляет загруженную сироту', () => {
    const deps = { deleteAttachment: vi.fn(async () => undefined), revokeObjectURL: vi.fn() };
    discardVoice(deps, { id: 'p', pendingVoice: { objectUrl: 'blob:1', attachment: serverAtt } } as unknown as ChatMessage);
    expect(deps.revokeObjectURL).toHaveBeenCalledWith('blob:1');
    expect(deps.deleteAttachment).toHaveBeenCalledWith('att-1');
  });
});
```
Run → FAIL.

- [ ] **Step 2: `messageStore.ts`**

Заменить тип `ChatMessage`:
```ts
/** Локальная запись голосового до/во время отправки (VYC-101). Никогда не уходит на сервер. */
export interface PendingVoice {
  blob: Blob;
  objectUrl: string;
  mimeType: string;
  durationMs: number;
  waveform: number[];
  /** Есть, если загрузка прошла — retry тогда не грузит файл заново. */
  attachment?: Attachment;
}

/** Client-only delivery state for optimistic send (spec §4.4). Never sent to the server. */
export type ChatMessage = Message & { deliveryState?: 'sending' | 'failed'; pendingVoice?: PendingVoice };
```
(импорт `Attachment` из `@/types`).

- [ ] **Step 3: `client/src/voice/sendVoice.ts`**
```ts
import type { ChatMessage } from '@/stores/messageStore';
import type { Attachment, Message } from '@/types';
import { waveformToBase64 } from './waveform';
import { voiceFileName, type VoiceRecording } from './voiceRecorder';

// … интерфейсы VoiceStore / SendVoiceDeps ровно как в блоке Interfaces …

/** Синтетическое вложение: пузырь играет из локального blob, пока файл грузится. */
export function buildPendingVoiceMessage(a: { tempId: string; channelId: string; userId: string; now: string; recording: VoiceRecording; objectUrl: string }): ChatMessage {
  const { recording: r } = a;
  const att: Attachment = {
    id: `${a.tempId}-voice`, channel_id: a.channelId, user_id: a.userId, kind: 'audio',
    file_name: voiceFileName(r.mimeType), content_type: r.mimeType, size_bytes: r.blob.size,
    url: a.objectUrl, created_at: a.now,
    is_voice: true, duration_ms: r.durationMs, waveform: waveformToBase64(r.waveform), listened: false,
  };
  return {
    id: a.tempId, channel_id: a.channelId, user_id: a.userId, kind: 'user', content: '',
    created_at: a.now, updated_at: a.now, deliveryState: 'sending', attachments: [att],
    pendingVoice: { blob: r.blob, objectUrl: a.objectUrl, mimeType: r.mimeType, durationMs: r.durationMs, waveform: r.waveform },
  };
}

// Строки, по которым прямо сейчас идёт отправка: защита от двойного retry.
const inFlight = new Set<string>();

async function deliver(deps: SendVoiceDeps, msg: ChatMessage): Promise<void> {
  const pv = msg.pendingVoice!;
  const channelId = msg.channel_id;
  if (inFlight.has(msg.id)) return;
  inFlight.add(msg.id);
  try {
    let attachment = pv.attachment;
    if (!attachment) {
      const file = new File([pv.blob], voiceFileName(pv.mimeType), { type: pv.mimeType });
      attachment = await deps.upload(channelId, file, { durationMs: pv.durationMs, waveform: pv.waveform });
      deps.store.update(msg.id, { pendingVoice: { ...pv, attachment } });
    }
    const saved = await deps.createMessage(channelId, attachment.id);
    deps.store.replace(msg.id, saved);
    deps.revokeObjectURL(pv.objectUrl);
  } catch (err) {
    if (deps.store.has(msg.id)) deps.store.update(msg.id, { deliveryState: 'failed' });
    else deps.onOrphanFailure(err);
  } finally {
    inFlight.delete(msg.id);
  }
}

export async function sendVoice(deps: SendVoiceDeps, a: { tempId: string; channelId: string; userId: string; now: string; recording: VoiceRecording }): Promise<void> {
  const objectUrl = deps.createObjectURL(a.recording.blob);
  const msg = buildPendingVoiceMessage({ ...a, objectUrl });
  deps.store.add(msg);
  await deliver(deps, msg);
}

export async function retryVoice(deps: SendVoiceDeps, msg: ChatMessage): Promise<void> {
  if (!msg.pendingVoice || inFlight.has(msg.id)) return;
  deps.store.update(msg.id, { deliveryState: 'sending' });
  // attachment мог записаться в store после того, как msg был прочитан вызывающим.
  await deliver(deps, msg);
}

export function discardVoice(deps: Pick<SendVoiceDeps, 'deleteAttachment' | 'revokeObjectURL'>, msg: ChatMessage): void {
  const pv = msg.pendingVoice;
  if (!pv) return;
  deps.revokeObjectURL(pv.objectUrl);
  // Уборщик подберёт сироту и сам; удаляем сразу, чтобы не ждать его прохода.
  if (pv.attachment) void deps.deleteAttachment(pv.attachment.id).catch(() => {});
}
```
Примечание к `retryVoice`: в ChatArea передавать **свежую** строку из store (`useMessageStore.getState().messages.find(...)`), как делает существующий `retrySend`, — тогда `pendingVoice.attachment` уже актуален.

Run: `npx vitest run src/voice/__tests__/sendVoice.test.ts` → PASS.

- [ ] **Step 4: Проводка в `ChatArea.tsx`**

Импорты: `sendVoice, retryVoice, discardVoice, type SendVoiceDeps` из `@/voice/sendVoice`, `type VoiceRecording` из `@/voice/voiceRecorder`.
Рядом с `sendMessage`:
```tsx
  const voiceDeps: SendVoiceDeps = {
    upload: (chan, file, voice) => apiService.uploadAttachment(chan, file, { voice }).promise,
    createMessage: async (chan, attId) => (await apiService.createMessage(chan, '', undefined, [attId])) as Message,
    deleteAttachment: (id) => apiService.deleteAttachment(id),
    store: {
      add: addMessage,
      update: updateMessage,
      replace: replaceMessage,
      has: (id) => useMessageStore.getState().messages.some((m) => m.id === id),
    },
    createObjectURL: (b) => URL.createObjectURL(b),
    revokeObjectURL: (u) => URL.revokeObjectURL(u),
    onOrphanFailure: (err) => showSendError(err),
  };

  /** Голосовое уходит сразу, без предпросмотра (spec §3.1). */
  const sendVoiceMessage = (recording: VoiceRecording) => {
    if (!channel || !user) return;
    void sendVoice(voiceDeps, {
      tempId: `pending-${Date.now()}-${pendingSeqRef.current++}`,
      channelId: channel.id, userId: user.id, now: new Date().toISOString(), recording,
    });
  };

  const discardFailed = (msg: ChatMessage) => {
    discardVoice(voiceDeps, msg);
    removeMessage(msg.id);
  };
```
В `retrySend` в самом начале после проверки `current.deliveryState !== 'failed'`:
```tsx
    if (current.pendingVoice) {
      await retryVoice(voiceDeps, current);
      return;
    }
```
(это до `updateMessage(msg.id, { deliveryState: 'sending' })` — `retryVoice` ставит `sending` сам).
Оба `onDiscard` (строки ~864 и ~978) заменить на `discardFailed(msg)` / `discardFailed(m)`.
`sendVoiceMessage` передаётся в Composer в Task 13.

- [ ] **Step 5: Гейты и существующие тесты ChatArea**

Run: `npx tsc --noEmit` → 0 байт; `npx vitest run src/components/__tests__/ChatArea` → PASS.

- [ ] **Step 6: Commit**
```bash
git add client/src/voice/sendVoice.ts client/src/voice/__tests__/sendVoice.test.ts client/src/stores/messageStore.ts client/src/components/ChatArea.tsx
git commit -m "VYC-101 client: оптимистичная отправка голосового с retry"
```

---

### Task 10: Общий код плееров (вынос из AudioPlayer/AttachmentImage)

**Files:**
- Create: `client/src/utils/formatTime.ts`, `client/src/hooks/useMediaPlayback.ts`, `client/src/hooks/useSelfHealingSrc.ts`
- Modify: `client/src/utils/chatMediaCoordinator.ts`, `client/src/components/AudioPlayer.tsx`, `client/src/components/VideoPlayer.tsx`, `client/src/components/MessageAttachments.tsx`
- Test: `client/src/hooks/__tests__/useSelfHealingSrc.test.tsx`, `client/src/utils/__tests__/formatTime.test.ts`, `client/src/utils/__tests__/chatMediaCoordinator.test.ts`

**Interfaces:**
- Produces:
```ts
export function formatTime(sec: number): string;              // utils/formatTime.ts; NaN/Infinity → '0:00'
export function pauseCurrent(): void;                          // chatMediaCoordinator.ts
export function useMediaPlayback<T extends HTMLMediaElement>(opts?: { onPlay?: () => void }): {
  ref: React.RefObject<T | null>; playing: boolean; current: number; duration: number;
  toggle(): void; seek(sec: number): void;
  mediaProps: { ref; onPlay; onPause; onEnded; onTimeUpdate; onLoadedMetadata };
};
export function useSelfHealingSrc(attachmentId: string, initialUrl: string | undefined, pick?: (a: Attachment) => string | undefined): { src: string | undefined; onError: () => void };
```

- [ ] **Step 1: Падающие тесты**

`client/src/utils/__tests__/formatTime.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { formatTime } from '@/utils/formatTime';
describe('formatTime', () => {
  it('m:ss', () => { expect(formatTime(0)).toBe('0:00'); expect(formatTime(65.9)).toBe('1:05'); expect(formatTime(900)).toBe('15:00'); });
  it('не число → 0:00', () => { expect(formatTime(NaN)).toBe('0:00'); expect(formatTime(Infinity)).toBe('0:00'); });
});
```
`client/src/utils/__tests__/chatMediaCoordinator.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { notifyPlaying, pauseCurrent } from '@/utils/chatMediaCoordinator';
const media = () => ({ paused: false, pause: vi.fn() }) as unknown as HTMLMediaElement;
describe('chatMediaCoordinator', () => {
  it('pauseCurrent ставит на паузу играющее', () => {
    const a = media();
    notifyPlaying(a);
    pauseCurrent();
    expect(a.pause).toHaveBeenCalled();
  });
  it('старт второго останавливает первый', () => {
    const a = media(); const b = media();
    notifyPlaying(a); notifyPlaying(b);
    expect(a.pause).toHaveBeenCalled();
  });
});
```
`client/src/hooks/__tests__/useSelfHealingSrc.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { apiService } from '@/services/api';
import { useSelfHealingSrc } from '@/hooks/useSelfHealingSrc';

describe('useSelfHealingSrc', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('на ошибке один раз берёт свежую подпись', async () => {
    const spy = vi.spyOn(apiService, 'getAttachment').mockResolvedValue({ id: 'a', url: '/fresh' } as never);
    const { result } = renderHook(() => useSelfHealingSrc('a', '/stale'));
    await act(async () => { result.current.onError(); });
    await waitFor(() => expect(result.current.src).toMatch(/\/fresh$/));
    await act(async () => { result.current.onError(); });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('blob:-URL не чинится', async () => {
    const spy = vi.spyOn(apiService, 'getAttachment');
    const { result } = renderHook(() => useSelfHealingSrc('pending-1-voice', 'blob:x'));
    await act(async () => { result.current.onError(); });
    expect(spy).not.toHaveBeenCalled();
    expect(result.current.src).toBe('blob:x');
  });
});
```
Run → FAIL.

- [ ] **Step 2: Реализация**

`utils/formatTime.ts`:
```ts
/** m:ss для плееров чата. Не-конечное (NaN у jsdom, Infinity у WebM) — 0:00. */
export function formatTime(sec: number): string {
  if (!Number.isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
```
`chatMediaCoordinator.ts` дописать:
```ts
/** Ставит на паузу текущее медиа чата — старт записи голосового (VYC-101). */
export function pauseCurrent(): void {
  if (current && !current.paused) current.pause();
}
```
`hooks/useSelfHealingSrc.ts`:
```ts
import { useState } from 'react';
import { apiService, resolveUploadUrl } from '@/services/api';
import type { Attachment } from '@/types';

/**
 * Самопочинка протухшей подписи (вынесено из AttachmentImage): подпись живёт
 * неделю, и у долго открытой вкладки она протухает. Первый onError берёт
 * свежие метаданные; второй раз не пробуем. blob:-URL (оптимистичная строка
 * голосового) чинить нечем и незачем.
 */
export function useSelfHealingSrc(
  attachmentId: string,
  initialUrl: string | undefined,
  pick: (a: Attachment) => string | undefined = (a) => a.url,
) {
  const isBlob = !!initialUrl?.startsWith('blob:');
  const [src, setSrc] = useState(isBlob ? initialUrl : resolveUploadUrl(initialUrl));
  const [refreshed, setRefreshed] = useState(false);
  const onError = async () => {
    if (refreshed || isBlob) return;
    setRefreshed(true);
    try {
      const fresh = await apiService.getAttachment(attachmentId);
      setSrc(resolveUploadUrl(pick(fresh)));
    } catch {
      // Вложение удалено или доступ пропал — оставляем как есть.
    }
  };
  return { src, onError };
}
```
(Проверить сигнатуру `resolveUploadUrl` — принимает `string | undefined`? Если только `string`, передавать `initialUrl ?? ''`.)
`hooks/useMediaPlayback.ts`:
```ts
import { useRef, useState, type SyntheticEvent } from 'react';
import { notifyPlaying } from '@/utils/chatMediaCoordinator';

/** Общее ядро плееров чата (AudioPlayer, VoiceMessage). */
export function useMediaPlayback<T extends HTMLMediaElement>(opts: { onPlay?: () => void } = {}) {
  const ref = useRef<T>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  const toggle = () => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) {
      // Останавливаем предыдущий элемент ДО play(), а не в onPlay: на мобильных
      // медиа делят одну аудио-сессию, и пока прежний не отпущен, новый play()
      // может тихо не сработать.
      notifyPlaying(el);
      void el.play()?.catch(() => {});
    } else {
      el.pause();
    }
  };

  const seek = (sec: number) => {
    const el = ref.current;
    if (!el) return;
    el.currentTime = sec;
    setCurrent(el.currentTime);
  };

  const mediaProps = {
    ref,
    onPlay: (e: SyntheticEvent<T>) => { setPlaying(true); notifyPlaying(e.currentTarget); opts.onPlay?.(); },
    onPause: () => setPlaying(false),
    onEnded: () => setPlaying(false),
    onTimeUpdate: (e: SyntheticEvent<T>) => setCurrent(e.currentTarget.currentTime),
    onLoadedMetadata: (e: SyntheticEvent<T>) => setDuration(e.currentTarget.duration),
  };

  return { ref, playing, current, duration, toggle, seek, mediaProps };
}
```
`AudioPlayer.tsx` — переписать на хук, разметку и классы не менять:
```tsx
import { Pause, Play } from 'lucide-react';
import { useT } from '@/i18n';
import { useMediaPlayback } from '@/hooks/useMediaPlayback';
import { useSelfHealingSrc } from '@/hooks/useSelfHealingSrc';
import { formatTime } from '@/utils/formatTime';
import './AudioPlayer.css';

interface AudioPlayerProps { attachmentId: string; src: string; fileName: string }

/** Свой плеер, а не голый <audio controls>: нативный контрол выглядит по-разному в каждом движке и не попадает в тему. */
export function AudioPlayer({ attachmentId, src, fileName }: AudioPlayerProps) {
  const t = useT();
  const media = useMediaPlayback<HTMLAudioElement>();
  const healed = useSelfHealingSrc(attachmentId, src);
  return (
    <div className="audio-player">
      <button type="button" className="audio-play-btn" onClick={media.toggle} aria-label={media.playing ? t('chat.pause') : t('chat.play')}>
        {media.playing ? <Pause size={16} strokeWidth={1.8} /> : <Play size={16} strokeWidth={1.8} />}
      </button>
      <div className="audio-body">
        <span className="audio-name" title={fileName}>{fileName}</span>
        <input type="range" className="audio-seek" aria-label={t('chat.seekPosition')} min={0} max={media.duration || 0} step={0.1}
          value={media.current} onChange={(e) => media.seek(Number(e.target.value))} />
      </div>
      <span className="audio-time">{formatTime(media.current)} / {formatTime(media.duration)}</span>
      <audio {...media.mediaProps} src={healed.src} preload="metadata" onError={healed.onError} />
    </div>
  );
}
```
`MessageAttachments.tsx`: `AttachmentImage` перевести на `useSelfHealingSrc(att.id, att.thumb_url || att.url, (a) => a.thumb_url || a.url)`; `<AudioPlayer attachmentId={att.id} src={att.url} …/>` (сырой `att.url` — хук сам делает `resolveUploadUrl`). `VideoPlayer.tsx`: удалить локальную `formatTime`, импортировать из `@/utils/formatTime`.

- [ ] **Step 3: Прогнать**

Run: `npx vitest run src/utils src/hooks src/components/__tests__/MessageAttachments.test.tsx src/components/__tests__/VideoPlayer.test.tsx` → PASS (если тест `MessageAttachments` проверяет `AudioPlayer` по пропсам — обновить ожидание на новый проп `attachmentId`, поведение не менять). `npx tsc --noEmit` → 0 байт.

- [ ] **Step 4: Commit**
```bash
git add client/src/utils/formatTime.ts client/src/utils/chatMediaCoordinator.ts client/src/hooks/useMediaPlayback.ts \
  client/src/hooks/useSelfHealingSrc.ts client/src/components/AudioPlayer.tsx client/src/components/VideoPlayer.tsx \
  client/src/components/MessageAttachments.tsx client/src/utils/__tests__/formatTime.test.ts \
  client/src/utils/__tests__/chatMediaCoordinator.test.ts client/src/hooks/__tests__/useSelfHealingSrc.test.tsx
git commit -m "VYC-101 client: общий код плееров чата и самопочинка ссылок"
```
(Если какие-то из этих `__tests__` каталогов не существуют — создать; пути в `git add` оставить как есть.)

---

### Task 11: Пузырь голосового

**Files:**
- Create: `client/src/voice/listened.ts`, `client/src/stores/voicePlaybackStore.ts`, `client/src/components/VoiceWaveform.tsx`, `client/src/components/VoiceMessage.tsx`, `client/src/components/VoiceMessage.css`
- Modify: `client/src/stores/messageStore.ts`, `client/src/components/MessageAttachments.tsx`, `client/src/components/MessageRow.tsx`, `client/src/mobile/chat/useMessageActions.tsx`
- Test: `client/src/voice/__tests__/listened.test.ts`, `client/src/stores/__tests__/voicePlaybackStore.test.ts`, `client/src/components/__tests__/VoiceMessage.test.tsx`

**Interfaces:**
- Consumes: `useMediaPlayback`, `useSelfHealingSrc`, `formatTime` (Task 10); `waveformFromBase64` (Task 6); `apiService.markVoiceListened` (Task 6); `useAuthStore` (`s.user?.id`).
- Produces:
```ts
// voice/listened.ts
export interface VoiceListenedEvent { channel_id: string; message_id: string; attachment_id: string; user_id: string }
export function applyVoiceListened<M extends Message>(messages: M[], ev: Pick<VoiceListenedEvent, 'attachment_id' | 'user_id'>, meId: string): M[]; // та же ссылка, если ничего не поменялось
export function isVoiceMessage(m: Pick<Message, 'attachments'>): boolean;
// messageStore.ts
applyListened(ev: Pick<VoiceListenedEvent, 'attachment_id' | 'user_id'>, meId: string): void;
// stores/voicePlaybackStore.ts
export const VOICE_RATES = [1, 1.5, 2] as const;
export const useVoicePlaybackStore: { rate: 1 | 1.5 | 2; cycle(): void };
// components
export function VoiceMessage(props: { att: Attachment }): JSX.Element;
export function VoiceWaveform(props: { values: number[]; progress: number /*0..1*/; durationSec: number; onSeek(fraction: number): void }): JSX.Element;
```

- [ ] **Step 1: Падающие тесты `listened` и store скорости**

`client/src/voice/__tests__/listened.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { applyVoiceListened, isVoiceMessage } from '@/voice/listened';
import type { Message } from '@/types';

const msg = (attUser: string, listened = false) => ({
  id: 'm', attachments: [{ id: 'v', user_id: attUser, is_voice: true, listened }],
}) as unknown as Message;

describe('applyVoiceListened', () => {
  it('я слушал (другое устройство) → listened', () => {
    expect(applyVoiceListened([msg('author')], { attachment_id: 'v', user_id: 'me' }, 'me')[0].attachments![0].listened).toBe(true);
  });
  it('я автор, слушал другой → listened', () => {
    expect(applyVoiceListened([msg('me')], { attachment_id: 'v', user_id: 'bob' }, 'me')[0].attachments![0].listened).toBe(true);
  });
  it('слушал третий, я не автор → без изменений, та же ссылка', () => {
    const list = [msg('author')];
    expect(applyVoiceListened(list, { attachment_id: 'v', user_id: 'bob' }, 'me')).toBe(list);
  });
  it('неизвестное вложение → та же ссылка', () => {
    const list = [msg('me')];
    expect(applyVoiceListened(list, { attachment_id: 'zzz', user_id: 'bob' }, 'me')).toBe(list);
  });
  it('isVoiceMessage', () => {
    expect(isVoiceMessage(msg('a'))).toBe(true);
    expect(isVoiceMessage({ attachments: [] })).toBe(false);
    expect(isVoiceMessage({})).toBe(false);
  });
});
```
`client/src/stores/__tests__/voicePlaybackStore.test.ts`:
```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('voicePlaybackStore', () => {
  beforeEach(() => { localStorage.clear(); vi.resetModules(); });

  it('цикл 1 → 1.5 → 2 → 1 и запоминание', async () => {
    const { useVoicePlaybackStore } = await import('@/stores/voicePlaybackStore');
    const s = useVoicePlaybackStore;
    expect(s.getState().rate).toBe(1);
    s.getState().cycle(); expect(s.getState().rate).toBe(1.5);
    s.getState().cycle(); expect(s.getState().rate).toBe(2);
    expect(localStorage.getItem('vycord.voiceRate')).toBe('2');
    s.getState().cycle(); expect(s.getState().rate).toBe(1);
  });

  it('читает сохранённое; мусор → 1', async () => {
    localStorage.setItem('vycord.voiceRate', '1.5');
    expect((await import('@/stores/voicePlaybackStore')).useVoicePlaybackStore.getState().rate).toBe(1.5);
    vi.resetModules();
    localStorage.setItem('vycord.voiceRate', '7');
    expect((await import('@/stores/voicePlaybackStore')).useVoicePlaybackStore.getState().rate).toBe(1);
  });

  it('недоступное хранилище — не падает', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    const { useVoicePlaybackStore } = await import('@/stores/voicePlaybackStore');
    expect(useVoicePlaybackStore.getState().rate).toBe(1);
    expect(() => useVoicePlaybackStore.getState().cycle()).not.toThrow();
  });
});
```
Run → FAIL.

- [ ] **Step 2: Реализация `listened.ts`, store, `messageStore.applyListened`**

`voice/listened.ts`:
```ts
import type { Message } from '@/types';

export interface VoiceListenedEvent { channel_id: string; message_id: string; attachment_id: string; user_id: string }

/**
 * Правило spec §1.5: «прослушано» для меня — если слушал я сам (синхронизация
 * устройств) или я автор и слушал кто-то другой. Иначе событие не про меня.
 */
export function applyVoiceListened<M extends Message>(messages: M[], ev: Pick<VoiceListenedEvent, 'attachment_id' | 'user_id'>, meId: string): M[] {
  let changed = false;
  const next = messages.map((m) => {
    const atts = m.attachments;
    if (!atts?.some((a) => a.id === ev.attachment_id)) return m;
    const updated = atts.map((a) => {
      if (a.id !== ev.attachment_id || a.listened) return a;
      if (ev.user_id !== meId && a.user_id !== meId) return a;
      changed = true;
      return { ...a, listened: true };
    });
    return changed ? { ...m, attachments: updated } : m;
  });
  return changed ? next : messages;
}

export function isVoiceMessage(m: Pick<Message, 'attachments'>): boolean {
  return !!m.attachments?.some((a) => a.is_voice);
}
```
`stores/voicePlaybackStore.ts`:
```ts
import { create } from 'zustand';

export const VOICE_RATES = [1, 1.5, 2] as const;
type Rate = (typeof VOICE_RATES)[number];
const KEY = 'vycord.voiceRate';

function load(): Rate {
  try {
    const v = Number(localStorage.getItem(KEY));
    return (VOICE_RATES as readonly number[]).includes(v) ? (v as Rate) : 1;
  } catch {
    return 1;
  }
}

/** Скорость голосовых — одна на все пузыри, запоминается у зрителя. */
export const useVoicePlaybackStore = create<{ rate: Rate; cycle(): void }>((set, get) => ({
  rate: load(),
  cycle: () => {
    const rate = VOICE_RATES[(VOICE_RATES.indexOf(get().rate) + 1) % VOICE_RATES.length];
    set({ rate });
    try { localStorage.setItem(KEY, String(rate)); } catch { /* приватный режим — живём без памяти */ }
  },
}));
```
`messageStore.ts`: в интерфейс `applyListened: (ev: Pick<VoiceListenedEvent, 'attachment_id' | 'user_id'>, meId: string) => void;` и реализация:
```ts
  applyListened: (ev, meId) =>
    set((state) => {
      const messages = applyVoiceListened(state.messages, ev, meId);
      return messages === state.messages ? state : { messages };
    }),
```
Run: `npx vitest run src/voice/__tests__/listened.test.ts src/stores/__tests__/voicePlaybackStore.test.ts` → PASS.

- [ ] **Step 3: Падающий тест пузыря**

`client/src/components/__tests__/VoiceMessage.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { VoiceMessage } from '@/components/VoiceMessage';
import { apiService } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { useVoicePlaybackStore } from '@/stores/voicePlaybackStore';
import { waveformToBase64 } from '@/voice/waveform';
import type { Attachment } from '@/types';

const att = (over: Partial<Attachment> = {}): Attachment => ({
  id: 'v1', channel_id: 'c', user_id: 'author', kind: 'audio', file_name: 'voice.weba', content_type: 'audio/webm',
  size_bytes: 10, url: '/api/v1/attachments/v1/content?sig=x', created_at: '', is_voice: true, duration_ms: 4200,
  waveform: waveformToBase64(new Array(64).fill(128)), listened: false, ...over,
});

describe('VoiceMessage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ user: { id: 'me' } } as never);
    useVoicePlaybackStore.setState({ rate: 1 });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });

  it('64 столбика и длительность из duration_ms', () => {
    const { container } = render(<VoiceMessage att={att()} />);
    expect(container.querySelectorAll('.voice-msg-bar')).toHaveLength(64);
    expect(container.querySelector('.voice-msg-time')?.textContent).toBe('0:04');
  });

  it('infinite duration falls back: Infinity у <audio> не показывается', () => {
    const { container } = render(<VoiceMessage att={att()} />);
    const audio = container.querySelector('audio')!;
    Object.defineProperty(audio, 'duration', { value: Infinity, configurable: true });
    fireEvent.loadedMetadata(audio);
    expect(container.textContent).not.toMatch(/Infinity|NaN/);
    expect(container.querySelector('.voice-msg-time')?.textContent).toBe('0:04');
  });

  it('точка у не-прослушанного; первый onPlay шлёт POST один раз и гасит точку', () => {
    const spy = vi.spyOn(apiService, 'markVoiceListened').mockResolvedValue();
    const { container } = render(<VoiceMessage att={att()} />);
    expect(container.querySelector('.voice-msg-dot')).not.toBeNull();
    const audio = container.querySelector('audio')!;
    fireEvent.play(audio);
    fireEvent.play(audio);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('v1');
    expect(container.querySelector('.voice-msg-dot')).toBeNull();
  });

  it('автор не шлёт POST и своей игрой точку не гасит', () => {
    const spy = vi.spyOn(apiService, 'markVoiceListened').mockResolvedValue();
    const { container } = render(<VoiceMessage att={att({ user_id: 'me' })} />);
    fireEvent.play(container.querySelector('audio')!);
    expect(spy).not.toHaveBeenCalled();
    expect(container.querySelector('.voice-msg-dot')).not.toBeNull();
  });

  it('гостю (listened нет) точки нет и POST нет', () => {
    useAuthStore.setState({ user: null } as never);
    const spy = vi.spyOn(apiService, 'markVoiceListened').mockResolvedValue();
    const { container } = render(<VoiceMessage att={att({ listened: undefined })} />);
    fireEvent.play(container.querySelector('audio')!);
    expect(container.querySelector('.voice-msg-dot')).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('скорость циклится и применяется к audio', () => {
    const { container } = render(<VoiceMessage att={att()} />);
    fireEvent.click(screen.getByRole('button', { name: /1x|Скорость|speed/i }));
    expect(container.querySelector('audio')!.playbackRate).toBe(1.5);
    expect(container.querySelector('.voice-msg-rate')?.textContent).toBe('1.5x');
  });

  it('клавиатура на волне двигает позицию на ±5 с', () => {
    const { container } = render(<VoiceMessage att={att({ duration_ms: 60_000 })} />);
    const audio = container.querySelector('audio')!;
    // jsdom не реализует HTMLMediaElement: делаем currentTime обычным свойством.
    Object.defineProperty(audio, 'currentTime', { value: 0, writable: true, configurable: true });
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowRight' });
    expect(audio.currentTime).toBe(5);
  });
});
```
Run → FAIL.

- [ ] **Step 4: `VoiceWaveform.tsx`**
```tsx
import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { useT } from '@/i18n';
import { formatTime } from '@/utils/formatTime';

interface Props { values: number[]; progress: number; durationSec: number; onSeek(fraction: number): void }

const STEP_SEC = 5;

/** Волна голосового: 64 столбика, клик/перетаскивание и стрелки — перемотка. */
export function VoiceWaveform({ values, progress, durationSec, onSeek }: Props) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const bars = values.length ? values : new Array(64).fill(0);
  const played = Math.round(progress * bars.length);

  const fractionAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return r.width > 0 ? Math.min(1, Math.max(0, (clientX - r.left) / r.width)) : 0;
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    onSeek(fractionAt(e.clientX));
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => { if (dragging.current) onSeek(fractionAt(e.clientX)); };
  const stop = () => { dragging.current = false; };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (durationSec <= 0) return;
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? STEP_SEC : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -STEP_SEC : 0;
    if (!delta) return;
    e.preventDefault();
    onSeek(Math.min(1, Math.max(0, (progress * durationSec + delta) / durationSec)));
  };

  return (
    <div
      ref={ref}
      className="voice-msg-wave"
      role="slider"
      tabIndex={0}
      aria-label={t('voice.position')}
      aria-valuemin={0}
      aria-valuemax={Math.round(durationSec)}
      aria-valuenow={Math.round(progress * durationSec)}
      aria-valuetext={formatTime(progress * durationSec)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      onKeyDown={onKeyDown}
    >
      {bars.map((v, i) => (
        <span
          key={i}
          className={`voice-msg-bar${i < played ? ' is-played' : ''}`}
          style={{ '--voice-bar-h': `${Math.max(12, (v / 255) * 100)}%` } as React.CSSProperties}
        />
      ))}
    </div>
  );
}
```
- [ ] **Step 5: `VoiceMessage.tsx`**
```tsx
import { useEffect, useMemo, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { useT } from '@/i18n';
import { apiService } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { useMessageStore } from '@/stores/messageStore';
import { useVoicePlaybackStore } from '@/stores/voicePlaybackStore';
import { useMediaPlayback } from '@/hooks/useMediaPlayback';
import { useSelfHealingSrc } from '@/hooks/useSelfHealingSrc';
import { formatTime } from '@/utils/formatTime';
import { logger } from '@/utils/logger';
import { waveformFromBase64 } from '@/voice/waveform';
import { VoiceWaveform } from './VoiceWaveform';
import type { Attachment } from '@/types';
import './VoiceMessage.css';

/** Пузырь голосового (spec §3.3). Не «аудиофайл»: без имени и скачивания. */
export function VoiceMessage({ att }: { att: Attachment }) {
  const t = useT();
  const meId = useAuthStore((s) => s.user?.id);
  const rate = useVoicePlaybackStore((s) => s.rate);
  const cycleRate = useVoicePlaybackStore((s) => s.cycle);
  const healed = useSelfHealingSrc(att.id, att.url);
  // Локальная копия: пузырь гаснет сразу, не дожидаясь store/WS.
  const [listened, setListened] = useState(att.listened);
  useEffect(() => setListened(att.listened), [att.listened]);

  const isOwn = !!meId && att.user_id === meId;
  const onPlay = () => {
    if (!meId || isOwn || listened !== false) return;
    setListened(true);
    useMessageStore.getState().applyListened({ attachment_id: att.id, user_id: meId }, meId);
    apiService.markVoiceListened(att.id).catch((err: unknown) => {
      // Косметика и идемпотентно на сервере: без отката, только в лог.
      logger.error('Failed to mark voice listened', err, { module: 'chat' });
    });
  };
  const media = useMediaPlayback<HTMLAudioElement>({ onPlay });

  useEffect(() => { if (media.ref.current) media.ref.current.playbackRate = rate; }, [rate, media.ref]);

  const values = useMemo(() => waveformFromBase64(att.waveform), [att.waveform]);
  const metaSec = (att.duration_ms ?? 0) / 1000;
  // WebM из MediaRecorder отдаёт Infinity — тогда верим метаданным (spec §3.3).
  const totalSec = Number.isFinite(media.duration) && media.duration > 0 ? media.duration : metaSec;
  const progress = totalSec > 0 ? Math.min(1, media.current / totalSec) : 0;
  const shown = media.playing || media.current > 0 ? media.current : metaSec;

  return (
    <div className="voice-msg" aria-label={t('voice.message')}>
      <button type="button" className="voice-msg-play" onClick={media.toggle} aria-label={media.playing ? t('voice.pause') : t('voice.play')}>
        {media.playing ? <Pause size={18} strokeWidth={1.8} /> : <Play size={18} strokeWidth={1.8} />}
      </button>
      <div className="voice-msg-body">
        <VoiceWaveform values={values} progress={progress} durationSec={totalSec} onSeek={(f) => media.seek(f * totalSec)} />
        <div className="voice-msg-meta">
          <span className="voice-msg-time">{formatTime(shown)}</span>
          {listened === false && <span className="voice-msg-dot" role="img" aria-label={t('voice.unlistened')} />}
        </div>
      </div>
      <button type="button" className="voice-msg-rate" onClick={cycleRate} aria-label={t('voice.speed', { rate: `${rate}x` })}>
        {`${rate}x`}
      </button>
      <audio {...media.mediaProps} src={healed.src} preload="metadata" onError={healed.onError}
        onLoadedMetadata={(e) => { e.currentTarget.playbackRate = rate; media.mediaProps.onLoadedMetadata(e); }} />
    </div>
  );
}
```
(Проверить, что `useT()` принимает переменные вторым аргументом `t('voice.speed', { rate })` — так уже делает `chat.messagePlaceholder`.)

- [ ] **Step 6: `VoiceMessage.css`**
```css
/* Пузырь голосового (VYC-101). --voice-bar-h инжектируется из JS — fallback обязателен. */
.voice-msg {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 240px;
  max-width: 360px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: var(--canvas-2);
}

.voice-msg-play {
  flex: none;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--accent);
  color: var(--white);
  cursor: pointer;
  transition: background var(--transition) var(--ease-out);
}

.voice-msg-play:hover { background: var(--accent-hover); }

.voice-msg-play:focus-visible,
.voice-msg-rate:focus-visible,
.voice-msg-wave:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.voice-msg-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.voice-msg-wave {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 28px;
  cursor: pointer;
  touch-action: none;
  border-radius: var(--radius-chip);
}

.voice-msg-bar {
  flex: 1;
  height: var(--voice-bar-h, 12%);
  min-width: 2px;
  border-radius: var(--radius-pill);
  background: var(--muted-2);
}

.voice-msg-bar.is-played { background: var(--accent); }

.voice-msg-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.voice-msg-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-pill);
  background: var(--accent);
}

.voice-msg-rate {
  flex: none;
  min-width: 38px;
  padding: 3px 6px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-chip);
  background: transparent;
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.voice-msg-rate:hover { color: var(--ink); }

@media (width <= 480px) {
  .voice-msg { min-width: 0; width: 100%; }
}
```
(Если stylelint ругается на синтаксис media query или порядок — следовать его сообщению; значения цветов/радиусов не менять на сырые.)

- [ ] **Step 7: Маршрутизация и скрытие действий**

`MessageAttachments.tsx`: импорт `VoiceMessage`; в `map` **первой** веткой:
```tsx
        if (att.is_voice) {
          return (
            <div className="attachment-cell is-wide" key={att.id}>
              <VoiceMessage att={att} />
            </div>
          );
        }
```
`MessageRow.tsx`: импорт `isVoiceMessage`; `const voice = isVoiceMessage(msg);` и условия кнопок: цитата — `{!msg.sticker_id && !voice && (…)}`, правка — `{canModify && !msg.sticker_id && !voice && (…)}`.
`useMessageActions.tsx`: условие правки — `if (i.canModify && !msg.sticker_id && !isVoiceMessage(msg))` (цитата/копия уже скрыты пустым `content`).

- [ ] **Step 8: Прогнать**

Run: `npx vitest run src/components/__tests__/VoiceMessage.test.tsx src/components/__tests__/MessageAttachments.test.tsx src/components/__tests__/MessageRow.mobile.test.tsx src/voice src/stores` → PASS. `npx tsc --noEmit` и `npx stylelint "src/**/*.css"` → 0 байт.

- [ ] **Step 9: Commit**
```bash
git add client/src/voice/listened.ts client/src/voice/__tests__/listened.test.ts client/src/stores/voicePlaybackStore.ts \
  client/src/stores/__tests__/voicePlaybackStore.test.ts client/src/stores/messageStore.ts \
  client/src/components/VoiceWaveform.tsx client/src/components/VoiceMessage.tsx client/src/components/VoiceMessage.css \
  client/src/components/__tests__/VoiceMessage.test.tsx client/src/components/MessageAttachments.tsx \
  client/src/components/MessageRow.tsx client/src/mobile/chat/useMessageActions.tsx
git commit -m "VYC-101 client: пузырь голосового с волной, скоростью и отметкой прослушивания"
```

---

### Task 12: WS `voice_listened` в ленте

**Files:**
- Modify: `client/src/components/ChatArea.tsx`
- Test: `client/src/components/__tests__/ChatArea.voice.test.tsx`

**Interfaces:**
- Consumes: `wsService.on('voice_listened', …)`, `useMessageStore.getState().applyListened` (Task 11).

- [ ] **Step 1: Падающий тест**

Посмотреть `client/src/components/__tests__/chatHarness.tsx` и `ChatArea.dom.test.tsx` — как монтируется `ChatArea` и как эмулируется WS (скорее всего мок `wsService.on`, собирающий слушателей). Написать по тому же образцу `ChatArea.voice.test.tsx`:
```tsx
// @vitest-environment jsdom
// Сценарий: в ленте голосовое автора 'me' с listened=false; WS присылает
// voice_listened от 'bob' → точка гаснет. Затем событие от 'carol' для чужого
// голосового (автор 'bob') → не меняется.
```
Конкретно: засеять `useMessageStore.setState({ messages: [{ id: 'm1', …, attachments: [{ id: 'v1', user_id: 'me', is_voice: true, listened: false, … }] }, { id: 'm2', …, attachments: [{ id: 'v2', user_id: 'bob', is_voice: true, listened: false }] }] })`, смонтировать через харнесс с текущим пользователем `me`, вызвать сохранённый слушатель `voice_listened` с `{ channel_id, message_id: 'm1', attachment_id: 'v1', user_id: 'bob' }` и `{ …, message_id: 'm2', attachment_id: 'v2', user_id: 'carol' }`, затем:
```ts
const [m1, m2] = useMessageStore.getState().messages;
expect(m1.attachments![0].listened).toBe(true);
expect(m2.attachments![0].listened).toBe(false);
```
Run → FAIL (подписки нет).

- [ ] **Step 2: Реализация**

В `ChatArea.tsx` в эффект с `message_update`/`message_delete` добавить:
```tsx
    const unsubListened = wsService.on('voice_listened', (payload) => {
      const me = useAuthStore.getState().user?.id;
      if (me) useMessageStore.getState().applyListened(payload as VoiceListenedEvent, me);
    });
```
и `unsubListened()` в cleanup этого эффекта. Импорт `type VoiceListenedEvent` из `@/voice/listened` (и `useAuthStore`, если ещё не импортирован — иначе взять `user?.id` из уже имеющегося `user`, добавив его в deps эффекта).

- [ ] **Step 3: Прогнать**

Run: `npx vitest run src/components/__tests__/ChatArea` → PASS.

- [ ] **Step 4: Commit**
```bash
git add client/src/components/ChatArea.tsx client/src/components/__tests__/ChatArea.voice.test.tsx
git commit -m "VYC-101 client: отметка прослушивания в реальном времени"
```

---

### Task 13: Хук записи и UI композера

**Files:**
- Create: `client/src/hooks/useVoiceRecording.ts`, `client/src/components/VoiceRecorderBar.tsx`, `client/src/components/VoiceRecorderBar.css`
- Modify: `client/src/components/Composer.tsx`, `client/src/components/Composer.css`, `client/src/components/ChatArea.tsx`
- Test: `client/src/hooks/__tests__/useVoiceRecording.test.tsx`, `client/src/components/__tests__/Composer.voice.test.tsx`

**Interfaces:**
- Consumes: `reduce`, `IDLE`, типы (Task 7); `startVoiceRecorder`, `VoiceRecorderHandle`, `VoiceRecording`, `toRecorderFailure` (Task 8); `pauseCurrent` (Task 10); `useCallStore` (`callChannelId`), `callService.isInCallState`; `sendVoiceMessage` из ChatArea (Task 9).
- Produces:
```ts
export interface UseVoiceRecording {
  state: GestureState; elapsedMs: number; level: number /*0..1*/; hint: HintKind | null;
  micProps: {
    onPointerDown(e: React.PointerEvent<HTMLButtonElement>): void;
    onPointerMove(e: React.PointerEvent<HTMLButtonElement>): void;
    onPointerUp(e: React.PointerEvent<HTMLButtonElement>): void;
    onPointerCancel(): void;
    onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>): void;
    onClick(e: React.MouseEvent<HTMLButtonElement>): void;
    onContextMenu(e: React.MouseEvent): void;
  };
  lockedSend(): void; lockedDelete(): void;
}
export function useVoiceRecording(a: { channelId: string; onSend(r: VoiceRecording): void; start?: typeof startVoiceRecorder; isInCall?: () => boolean }): UseVoiceRecording;
// Composer: новый проп onSendVoice?: (r: VoiceRecording) => void
export function VoiceRecorderBar(p: { state: GestureState; elapsedMs: number; level: number; onDelete(): void; onSend(): void }): JSX.Element | null;
```

- [ ] **Step 1: Падающие тесты хука**

`client/src/hooks/__tests__/useVoiceRecording.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVoiceRecording } from '@/hooks/useVoiceRecording';
import type { VoiceRecorderHandle } from '@/voice/voiceRecorder';

function deferredHandle() {
  const handle: VoiceRecorderHandle = {
    level: () => 0.3,
    stop: vi.fn(async () => ({ blob: new Blob(['x']), mimeType: 'audio/webm', durationMs: 2000, waveform: new Array(64).fill(1) })),
    discard: vi.fn(),
  };
  let resolve!: (h: VoiceRecorderHandle) => void;
  const promise = new Promise<VoiceRecorderHandle>((r) => { resolve = r; });
  return { handle, start: vi.fn(() => promise), resolve: () => resolve(handle) };
}

const ptr = (x: number, y: number) => ({ clientX: x, clientY: y, pointerId: 1, button: 0, currentTarget: { setPointerCapture: vi.fn() }, preventDefault: vi.fn() }) as never;

describe('useVoiceRecording', () => {
  let now = 0;
  beforeEach(() => { now = 0; vi.spyOn(performance, 'now').mockImplementation(() => now); vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] }); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('удержание → отпускание → onSend', async () => {
    const d = deferredHandle(); const onSend = vi.fn();
    const { result } = renderHook(() => useVoiceRecording({ channelId: 'a', onSend, start: d.start, isInCall: () => false }));
    act(() => result.current.micProps.onPointerDown(ptr(100, 100)));
    await act(async () => { d.resolve(); });
    expect(result.current.state.kind).toBe('recording');
    now = 2000;
    await act(async () => { result.current.micProps.onPointerUp(ptr(100, 100)); });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(result.current.state.kind).toBe('idle');
  });

  it('late start is released: отпустил до старта рекордера', async () => {
    const d = deferredHandle(); const onSend = vi.fn();
    const { result } = renderHook(() => useVoiceRecording({ channelId: 'a', onSend, start: d.start, isInCall: () => false }));
    act(() => result.current.micProps.onPointerDown(ptr(100, 100)));
    act(() => result.current.micProps.onPointerUp(ptr(100, 100)));
    expect(result.current.hint).toBe('hold');
    await act(async () => { d.resolve(); });
    expect(d.handle.discard).toHaveBeenCalled();
    expect(result.current.state.kind).toBe('idle');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('channel change discards', async () => {
    const d = deferredHandle(); const onSend = vi.fn();
    const { result, rerender } = renderHook(({ ch }) => useVoiceRecording({ channelId: ch, onSend, start: d.start, isInCall: () => false }), { initialProps: { ch: 'a' } });
    act(() => result.current.micProps.onPointerDown(ptr(100, 100)));
    await act(async () => { d.resolve(); });
    rerender({ ch: 'b' });
    expect(d.handle.discard).toHaveBeenCalled();
    expect(result.current.state.kind).toBe('idle');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('keyboard start once: автоповтор и click после keyup не дублируют', async () => {
    const d = deferredHandle();
    const { result } = renderHook(() => useVoiceRecording({ channelId: 'a', onSend: vi.fn(), start: d.start, isInCall: () => false }));
    const key = (repeat: boolean) => ({ key: ' ', repeat, preventDefault: vi.fn() }) as never;
    act(() => result.current.micProps.onKeyDown(key(false)));
    act(() => result.current.micProps.onKeyDown(key(true)));
    act(() => result.current.micProps.onClick({ detail: 0, preventDefault: vi.fn() } as never));
    await act(async () => { d.resolve(); });
    expect(d.start).toHaveBeenCalledTimes(1);
    expect(result.current.state.kind).toBe('locked');
    expect(result.current.hint).toBeNull();
  });

  it('в звонке — подсказка, рекордер не стартует', () => {
    const d = deferredHandle();
    const { result } = renderHook(() => useVoiceRecording({ channelId: 'a', onSend: vi.fn(), start: d.start, isInCall: () => true }));
    act(() => result.current.micProps.onPointerDown(ptr(100, 100)));
    expect(d.start).not.toHaveBeenCalled();
    expect(result.current.hint).toBe('call');
  });

  it('blur окна во время удержания — отмена и освобождение', async () => {
    const d = deferredHandle();
    const { result } = renderHook(() => useVoiceRecording({ channelId: 'a', onSend: vi.fn(), start: d.start, isInCall: () => false }));
    act(() => result.current.micProps.onPointerDown(ptr(100, 100)));
    await act(async () => { d.resolve(); });
    act(() => { window.dispatchEvent(new Event('blur')); });
    expect(d.handle.discard).toHaveBeenCalled();
    expect(result.current.hint).toBe('interrupted');
  });

  it('размонтирование во время записи освобождает', async () => {
    const d = deferredHandle();
    const { result, unmount } = renderHook(() => useVoiceRecording({ channelId: 'a', onSend: vi.fn(), start: d.start, isInCall: () => false }));
    act(() => result.current.micProps.onPointerDown(ptr(100, 100)));
    await act(async () => { d.resolve(); });
    unmount();
    expect(d.handle.discard).toHaveBeenCalled();
  });

  it('лимит 15 минут отправляет', async () => {
    const d = deferredHandle(); const onSend = vi.fn();
    const { result } = renderHook(() => useVoiceRecording({ channelId: 'a', onSend, start: d.start, isInCall: () => false }));
    act(() => result.current.micProps.onPointerDown(ptr(100, 100)));
    await act(async () => { d.resolve(); });
    now = 900_000;
    await act(async () => { vi.advanceTimersByTime(250); });
    expect(onSend).toHaveBeenCalledTimes(1);
  });
});
```
Run → FAIL.

- [ ] **Step 2: Реализация `hooks/useVoiceRecording.ts`**
```ts
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { callService } from '@/services/call';
import { useCallStore } from '@/stores/callStore';
import { pauseCurrent } from '@/utils/chatMediaCoordinator';
import { IDLE, reduce, type GestureEvent, type GestureState, type HintKind } from '@/voice/voiceGesture';
import { startVoiceRecorder, toRecorderFailure, type VoiceRecorderHandle, type VoiceRecording } from '@/voice/voiceRecorder';

const TICK_MS = 200;
const HINT_MS = 2500;

const defaultInCall = () => useCallStore.getState().callChannelId !== null || callService.isInCallState;

/** Связка жест ↔ рекордер ↔ DOM (spec §2.3). Вся логика переходов — в voiceGesture. */
export function useVoiceRecording({ channelId, onSend, start = startVoiceRecorder, isInCall = defaultInCall }: {
  channelId: string; onSend(r: VoiceRecording): void; start?: typeof startVoiceRecorder; isInCall?: () => boolean;
}) {
  const [state, setState] = useState<GestureState>(IDLE);
  const [elapsedMs, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [hint, setHint] = useState<HintKind | null>(null);
  const stateRef = useRef<GestureState>(IDLE);
  const handleRef = useRef<VoiceRecorderHandle | null>(null);
  // Поколение старта: запоздавший getUserMedia старого поколения освобождается сразу.
  const genRef = useRef(0);
  const onSendRef = useRef(onSend);
  onSendRef.current = onSend;
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showHint = (h: HintKind) => {
    setHint(h);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(null), HINT_MS);
  };

  const dispatch = useCallback((event: GestureEvent) => {
    const { state: next, effects } = reduce(stateRef.current, event);
    stateRef.current = next;
    setState(next);
    for (const fx of effects) {
      switch (fx.type) {
        case 'startRecorder': {
          const gen = ++genRef.current;
          pauseCurrent();
          start().then(
            (h) => {
              if (gen !== genRef.current || stateRef.current.kind !== 'starting') { h.discard(); return; }
              handleRef.current = h;
              dispatch({ type: 'recorderStarted', t: performance.now() });
            },
            (err: unknown) => { if (gen === genRef.current) dispatch({ type: 'recorderFailed', reason: toRecorderFailure(err) }); },
          );
          break;
        }
        case 'discard':
          genRef.current++;
          handleRef.current?.discard();
          handleRef.current = null;
          break;
        case 'send': {
          genRef.current++;
          const h = handleRef.current;
          handleRef.current = null;
          h?.stop().then((r) => onSendRef.current(r), () => showHint('mic_failed'));
          break;
        }
        case 'hint':
          showHint(fx.hint);
          break;
      }
    }
  }, [start]);

  const active = state.kind !== 'idle';
  const recordingLike = state.kind === 'recording' || state.kind === 'locked';
  const startedAt = recordingLike ? state.startedAt : 0;

  // Таймер/уровень/лимит — только пока идёт запись.
  useEffect(() => {
    if (!recordingLike) { setElapsed(0); setLevel(0); return; }
    const id = setInterval(() => {
      const t = performance.now();
      setElapsed(t - startedAt);
      setLevel(handleRef.current?.level() ?? 0);
      dispatch({ type: 'tick', t });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [recordingLike, startedAt, dispatch]);

  // Потеря фокуса/скрытие вкладки — interrupt (в locked машина его игнорирует).
  useEffect(() => {
    if (!active) return;
    const onBlur = () => dispatch({ type: 'interrupt' });
    const onVis = () => { if (document.visibilityState === 'hidden') dispatch({ type: 'interrupt' }); };
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVis);
    return () => { window.removeEventListener('blur', onBlur); document.removeEventListener('visibilitychange', onVis); };
  }, [active, dispatch]);

  // Смена канала и размонтирование — запись не должна уехать не туда.
  useEffect(() => () => {
    if (stateRef.current.kind !== 'idle') {
      genRef.current++;
      handleRef.current?.discard();
      handleRef.current = null;
      stateRef.current = IDLE;
      setState(IDLE);
    }
  }, [channelId]);
  useEffect(() => () => { if (hintTimer.current) clearTimeout(hintTimer.current); }, []);

  const micProps = {
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      dispatch({ type: 'press', x: e.clientX, y: e.clientY, inCall: isInCall() });
    },
    onPointerMove: (e: PointerEvent<HTMLButtonElement>) => dispatch({ type: 'move', x: e.clientX, y: e.clientY }),
    onPointerUp: () => dispatch({ type: 'release', t: performance.now() }),
    onPointerCancel: () => dispatch({ type: 'interrupt' }),
    onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      if (e.repeat) return;
      dispatch({ type: 'keyboardStart', inCall: isInCall() });
    },
    // Клик мышью уже обработан pointer-событиями; click от клавиатуры (detail=0)
    // после keyup пробела — тоже. Сам по себе click ничего не делает.
    onClick: (e: MouseEvent<HTMLButtonElement>) => e.preventDefault(),
    onContextMenu: (e: MouseEvent) => e.preventDefault(),
  };

  return {
    state, elapsedMs, level, hint, micProps,
    lockedSend: () => dispatch({ type: 'lockedSend', t: performance.now() }),
    lockedDelete: () => dispatch({ type: 'lockedDelete' }),
  };
}
```
Замечание по тесту «channel change»: cleanup эффекта с `[channelId]` срабатывает при смене канала и при размонтировании — оба теста им покрыты. Run: `npx vitest run src/hooks/__tests__/useVoiceRecording.test.tsx` → PASS.

- [ ] **Step 3: `VoiceRecorderBar.tsx` + `.css`**
```tsx
import { ChevronUp, SendHorizontal, Trash2 } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { useT } from '@/i18n';
import { formatTime } from '@/utils/formatTime';
import type { GestureState } from '@/voice/voiceGesture';
import './VoiceRecorderBar.css';

interface Props { state: GestureState; elapsedMs: number; level: number; onDelete(): void; onSend(): void }

/** Полоса записи в композере (spec §2.4). В recording — таймер, уровень, «‹ Отмена» за пальцем; в locked — «Удалить»/«Отправить». */
export function VoiceRecorderBar({ state, elapsedMs, level, onDelete, onSend }: Props) {
  const t = useT();
  if (state.kind !== 'recording' && state.kind !== 'locked' && state.kind !== 'starting') return null;
  const locked = state.kind === 'locked';
  const dx = state.kind === 'recording' ? state.dx : 0;
  // Escape в закреплённой записи — «Удалить». Обработчик на самой полосе, не на document.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => { if (locked && e.key === 'Escape') { e.preventDefault(); onDelete(); } };

  return (
    <div className={`composer-voice${locked ? ' is-locked' : ''}`} role="group" aria-label={t('voice.recording')} onKeyDown={onKeyDown}>
      <span className="composer-voice-dot" aria-hidden="true" />
      <span className="composer-voice-time" aria-live="off">{formatTime(elapsedMs / 1000)}</span>
      <div className="level-meter composer-voice-level" aria-hidden="true">
        <div className="level-meter-fill" style={{ '--meter-level': `${Math.round(level * 100)}%` } as React.CSSProperties} />
      </div>
      {locked ? (
        <div className="composer-voice-actions">
          <button type="button" className="composer-icon-btn composer-voice-delete" onClick={onDelete} aria-label={t('voice.deleteRecording')} title={t('voice.deleteRecording')} data-autofocus>
            <Trash2 size={17} strokeWidth={1.8} />
          </button>
          <button type="button" className="composer-send composer-voice-send" onClick={onSend} aria-label={t('voice.sendRecording')} title={t('voice.sendRecording')}>
            <SendHorizontal size={17} strokeWidth={1.8} />
          </button>
        </div>
      ) : (
        <>
          <span className="composer-voice-cancel" style={{ '--voice-drag-x': `${dx}px` } as React.CSSProperties}>{t('voice.slideToCancel')}</span>
          <span className="composer-voice-lock" aria-label={t('voice.lockHint')} title={t('voice.lockHint')}>
            <ChevronUp size={14} strokeWidth={1.8} />
          </span>
        </>
      )}
    </div>
  );
}
```
Фокус на «Удалить» при входе в `locked`: в компоненте `useEffect(() => { if (locked) deleteRef.current?.focus(); }, [locked])` через `useRef<HTMLButtonElement>` (атрибут `data-autofocus` убрать, если он работает только внутри `useModalFocus`).
`VoiceRecorderBar.css`:
```css
/* Полоса записи голосового (VYC-101). --voice-drag-x и --meter-level
   инжектируются из JS — fallback обязателен. */
.composer-voice {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 4px;
  user-select: none;
}

.composer-voice-dot {
  flex: none;
  width: 9px;
  height: 9px;
  border-radius: var(--radius-pill);
  background: var(--danger);
  animation: composer-voice-pulse 1.2s var(--ease-out) infinite;
}

@keyframes composer-voice-pulse {
  50% { opacity: 0.35; }
}

.composer-voice-time {
  font-variant-numeric: tabular-nums;
  color: var(--ink);
  font-weight: 600;
}

.composer-voice-level { width: 90px; flex: none; }

.composer-voice-cancel {
  flex: 1;
  text-align: center;
  color: var(--muted);
  transform: translateX(var(--voice-drag-x, 0));
}

.composer-voice-lock { display: grid; place-items: center; color: var(--muted-2); }

.composer-voice-actions { display: flex; align-items: center; gap: 6px; margin-left: auto; }

.composer-voice-delete { color: var(--danger-text); }

@media (prefers-reduced-motion: reduce) {
  .composer-voice-dot { animation: none; }
}

@media (width <= 480px) {
  .composer-voice-level { width: 56px; }
}
```

- [ ] **Step 4: Падающий тест композера**

`client/src/components/__tests__/Composer.voice.test.tsx` (пропсы — как в `Composer.mobile.test.tsx`; скопировать его фабрику пропсов):
```tsx
// @vitest-environment jsdom
// 1) desktop, пустое поле, onSendVoice передан → есть кнопка с aria-label «Записать голосовое сообщение», нет «Отправить»;
//    ввести текст → «Отправить» вернулась, микрофона нет.
// 2) textOnly → микрофона нет никогда.
// 3) onSendVoice не передан → микрофона нет (гостевой/старые вызовы).
// 4) mobile, пустое поле → микрофон на месте «Отправить».
```
Каждый пункт — отдельный `it` с `render(<Composer {...props} />)`, `screen.queryByRole('button', { name: 'Записать голосовое сообщение' })`, `fireEvent.change(textarea, { target: { value: 'hi' } })`. Строки брать через `t(...)`, если в соседних тестах так принято. Run → FAIL.

- [ ] **Step 5: Composer**

В `ComposerProps`:
```ts
  /**
   * VYC-101: отправка записанного голосового. Без него микрофона нет —
   * гостевой чат и textOnly-режим голосовые не записывают.
   */
  onSendVoice?: (recording: VoiceRecording) => void;
```
В теле:
```tsx
  const voiceEnabled = !!onSendVoice && !textOnly;
  const voice = useVoiceRecording({ channelId: channel.id, onSend: (r) => onSendVoice?.(r) });
  const voiceActive = voice.state.kind !== 'idle';
  const showMic = voiceEnabled && !canSend && !voiceActive;
```
Разметка внутри `<form className="composer-field">`:
- `textarea` и кнопки `Aa`/эмодзи/скрепка рендерить только при `!voiceActive`; при `voiceActive` на их месте `<VoiceRecorderBar state={voice.state} elapsedMs={voice.elapsedMs} level={voice.level} onDelete={voice.lockedDelete} onSend={voice.lockedSend} />`. **Textarea не размонтировать** (черновик текста не теряется — он пустой по условию, но фокус-логика и `inputRef` завязаны на неё): вместо условного рендера повесить на неё `hidden={voiceActive}`.
- Кнопку «Отправить» условие: `{!showMic && !voiceActive && (!mobile || canSend) && (…)}`.
- Кнопка микрофона (остаётся смонтированной в `starting`/`recording`, чтобы не потерять pointer capture; в `locked` скрыта):
```tsx
        {voiceEnabled && !canSend && voice.state.kind !== 'locked' && (
          <button
            type="button"
            className={`composer-send composer-mic${voiceActive ? ' is-recording' : ''}`}
            aria-label={t('voice.record')}
            title={t('voice.recordKeyboardHint')}
            {...voice.micProps}
          >
            <Mic size={17} strokeWidth={1.8} />
          </button>
        )}
```
- Подсказка — над полем внутри `.composer-root` (не fixed, overlay-контракт не нужен):
```tsx
      {voice.hint && (
        <p className="composer-voice-hint" role="status" aria-live="polite">{t(HINT_KEYS[voice.hint])}</p>
      )}
```
с константой
```ts
const HINT_KEYS = {
  hold: 'voice.hintHold', call: 'voice.hintCall', interrupted: 'voice.hintInterrupted',
  mic_denied: 'voice.micDenied', mic_not_found: 'voice.micNotFound', mic_failed: 'voice.micFailed',
} as const satisfies Record<HintKind, TKey>;
```
(тип `TKey` — из `@/i18n`; если он называется иначе — взять тип, которым типизирован `t`.)
Импорты: `Mic` из `lucide-react`, `useVoiceRecording`, `VoiceRecorderBar`, типы `VoiceRecording`, `HintKind`.

`Composer.css` дописать:
```css
/* VYC-101: микрофон на месте «Отправить». Жест не должен уходить в скролл/выделение. */
.composer-mic {
  touch-action: none;
  user-select: none;
  -webkit-touch-callout: none;
}

.composer-mic.is-recording {
  background: var(--danger);
  color: var(--white);
  transform: scale(1.15);
  transition: transform var(--transition) var(--ease-out);
}

.composer-voice-hint {
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin: 0 0 6px;
  padding: 6px 12px;
  border-radius: var(--radius-row);
  background: var(--panel);
  color: var(--ink);
  box-shadow: var(--shadow-popover);
  font-size: 13px;
  white-space: nowrap;
  pointer-events: none;
  animation: fade-in var(--transition) var(--ease-out);
}
```
Убедиться, что у `.composer-root` есть `position: relative` (иначе добавить в его правило). Если `.composer-send` имеет `:disabled`-стили — микрофон никогда не `disabled`.

`ChatArea.tsx`: в `<Composer … />` добавить `onSendVoice={sendVoiceMessage}`. `GuestChatBody` не трогать (без пропа микрофона нет).

- [ ] **Step 6: Прогнать**

Run: `npx vitest run src/components/__tests__/Composer src/hooks src/components/__tests__/ChatArea` → PASS. `npx tsc --noEmit`, `npx stylelint "src/**/*.css"` → 0 байт. `npx vitest run src/styles` → PASS (контракт scrim: `.composer-voice-hint` — `absolute`, не `fixed`, под него не попадает).

- [ ] **Step 7: Commit**
```bash
git add client/src/hooks/useVoiceRecording.ts client/src/hooks/__tests__/useVoiceRecording.test.tsx \
  client/src/components/VoiceRecorderBar.tsx client/src/components/VoiceRecorderBar.css \
  client/src/components/Composer.tsx client/src/components/Composer.css client/src/components/ChatArea.tsx \
  client/src/components/__tests__/Composer.voice.test.tsx
git commit -m "VYC-101 client: запись голосового удержанием микрофона в композере"
```

---

### Task 14: Полные гейты и ручная проверка

**Files:** без новых; правки — только по найденному.

- [ ] **Step 1: Сервер**

Run (из корня):
```bash
make test; echo "test=$?"
make vet; echo "vet=$?"
(cd server && gofmt -l ./internal ./cmd ./pkg)
```
Expected: `test=0`, `vet=0`, gofmt — пустой вывод. `make lint` — только если окружение починено (см. Global Constraints); иначе в отчёте: «lint не прогонялся: сломан окружением до изменений (50 typecheck, golangci-lint 1.64.6/go1.24 vs go1.27)».
С Postgres: `VYCORD_TEST_DSN=… go test ./internal/repository/postgres/ -run 'Migration027|ListenedFor' -v`. Дополнительно — прогнать up→down→up 027 вручную через `make migrate-up` / `make migrate-down` на dev-БД, если она есть.

- [ ] **Step 2: Клиент — четыре гейта (из `client/`)**
```bash
npx tsc --noEmit > /tmp/vyc101-tsc.txt 2>&1; echo "tsc=$?"; wc -c < /tmp/vyc101-tsc.txt
npx stylelint "src/**/*.css" > /tmp/vyc101-sl.txt 2>&1; echo "stylelint=$?"; wc -c < /tmp/vyc101-sl.txt
npm run check:i18n
npm test 2>&1 | tee /tmp/vyc101-test.txt | tail -20; grep -E "FAIL " /tmp/vyc101-test.txt | sort -u
```
Expected: `tsc=0` + `0`; `stylelint=0` + `0`; «непереведённых строк не найдено.»; ровно 3 падения, все строки `FAIL` указывают на `api.network-retry.test.ts`.

- [ ] **Step 3: Ручная проверка**

Свежий dev-сервер (`npm run dev:vite`, убедиться, что стартовал после последнего коммита), бэкенд с применённой миграцией 027, два аккаунта в одном канале. Обе темы, ширина ~375px и десктоп:
1. Удержание мыши на микрофоне ~3 с → отпустил → пузырь сразу в ленте (sending), затем обычный; на втором аккаунте появился с точкой.
2. Удержание → потянуть вверх → закреплено → «Отправить»; ещё раз → «Удалить» — ничего не ушло; Escape в закреплённой — удалить.
3. Удержание → потянуть влево → отмена, ничего не ушло, индикатор микрофона ОС погас.
4. Короткий клик → «Удерживайте, чтобы записать».
5. Войти в звонок → нажать микрофон → «Нельзя записать голосовое во время звонка».
6. Второй аккаунт нажимает play → у отправителя точка гаснет без перезагрузки; перезагрузка страницы — статус сохранился у обоих.
7. Скорость 1x→1.5x→2x; перезагрузка — скорость запомнилась. Перемотка кликом и перетаскиванием; стрелки на сфокусированной волне.
8. Tab до микрофона → Enter → закреплённая запись → Tab до «Отправить» → Enter.
9. Один играет, запускаю другое голосовое/видео — первое на паузе; начало записи ставит на паузу играющее.
10. Отключить сеть (DevTools offline) → записать → failed-строка → включить сеть → retry → ушло одно сообщение.
11. Мобильная ширина с тач-эмуляцией (DevTools): те же жесты пальцем; страница не скроллится при свайпе по микрофону.
12. Если есть Safari/iOS — запись уходит как `audio/mp4`, в ленте голосовое, не видео.

Если что-то найдено — исправить в затронутой задаче отдельным коммитом с явными путями и повторить Step 1–2.

- [ ] **Step 4: Итоговый отчёт**

Сводка: результаты гейтов с выводом, что проверено руками (по пунктам), что не проверено и почему (например, Safari, интеграционные тесты без Postgres). Не пушить.
