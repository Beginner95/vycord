package handler_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"github.com/vycord/server/internal/delivery/http/handler"
	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/pkg/attachlink"
)

type MockAttachmentUseCase struct{ mock.Mock }

func (m *MockAttachmentUseCase) Upload(in domain.AttachmentUpload) (*domain.Attachment, error) {
	args := m.Called(in)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*domain.Attachment), args.Error(1)
}

func (m *MockAttachmentUseCase) GetForUser(id, userID uuid.UUID) (*domain.Attachment, error) {
	args := m.Called(id, userID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*domain.Attachment), args.Error(1)
}

func (m *MockAttachmentUseCase) OpenContent(id uuid.UUID) (*domain.Attachment, io.ReadSeekCloser, error) {
	args := m.Called(id)
	if args.Get(0) == nil {
		return nil, nil, args.Error(2)
	}
	return args.Get(0).(*domain.Attachment), args.Get(1).(io.ReadSeekCloser), args.Error(2)
}

func (m *MockAttachmentUseCase) OpenThumb(id uuid.UUID) (*domain.Attachment, io.ReadSeekCloser, error) {
	args := m.Called(id)
	if args.Get(0) == nil {
		return nil, nil, args.Error(2)
	}
	return args.Get(0).(*domain.Attachment), args.Get(1).(io.ReadSeekCloser), args.Error(2)
}

func (m *MockAttachmentUseCase) Delete(id, userID uuid.UUID) error {
	return m.Called(id, userID).Error(0)
}

type MockQuotaUseCase struct{ mock.Mock }

func (m *MockQuotaUseCase) For(userID uuid.UUID) (*domain.Quota, error) {
	args := m.Called(userID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*domain.Quota), args.Error(1)
}

func (m *MockQuotaUseCase) CheckUpload(userID uuid.UUID, size int64) error {
	return m.Called(userID, size).Error(0)
}

func (m *MockQuotaUseCase) ExpiresAt(userID uuid.UUID, now time.Time) (*time.Time, error) {
	args := m.Called(userID, now)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*time.Time), args.Error(1)
}

// testDefaultMaxFileBytes — заведомо большой лимит для тестов, которым сама
// проверка по Content-Length не интересна: она не должна срабатывать на их
// маленьких телах.
const testDefaultMaxFileBytes = 1 << 30

func newQuotaMock(maxFileBytes int64) *MockQuotaUseCase {
	q := new(MockQuotaUseCase)
	q.On("For", mock.Anything).Return(&domain.Quota{MaxFileBytes: maxFileBytes}, nil)
	return q
}

func newUploadRequest(t *testing.T, channelID uuid.UUID, fileName string, content []byte, userID uuid.UUID) *http.Request {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	require.NoError(t, w.WriteField("channel_id", channelID.String()))
	part, err := w.CreateFormFile("file", fileName)
	require.NoError(t, err)
	_, err = part.Write(content)
	require.NoError(t, err)
	require.NoError(t, w.Close())

	req := httptest.NewRequest(http.MethodPost, "/api/v1/attachments", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	return req.WithContext(context.WithValue(req.Context(), "user_id", userID))
}

func newAttachmentHandler(uc domain.AttachmentUseCase) *handler.AttachmentHandler {
	signer := attachlink.NewSigner("test-secret", time.Hour)
	return handler.NewAttachmentHandler(uc, newQuotaMock(testDefaultMaxFileBytes), signer, 30<<20, slog.Default())
}

func TestUploadReturnsSignedURLs(t *testing.T) {
	userID, channelID := uuid.New(), uuid.New()
	attID := uuid.New()
	uc := new(MockAttachmentUseCase)
	uc.On("Upload", mock.Anything).Return(&domain.Attachment{
		ID: attID, UserID: userID, ChannelID: channelID,
		Kind: domain.AttachmentKindImage, FileName: "pic.png", SizeBytes: 4,
		StorageKey: "attachments/x/y.png", ThumbKey: "attachments/x/y_thumb.jpg",
	}, nil)

	rec := httptest.NewRecorder()
	newAttachmentHandler(uc).Upload(rec, newUploadRequest(t, channelID, "pic.png", []byte("data"), userID))

	require.Equal(t, http.StatusCreated, rec.Code)
	var got domain.Attachment
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &got))
	assert.Contains(t, got.URL, "/api/v1/attachments/"+attID.String()+"/content?")
	assert.Contains(t, got.ThumbURL, "/api/v1/attachments/"+attID.String()+"/thumb?")
	assert.Contains(t, got.URL, "sig=")
}

func TestUploadNeverLeaksStorageKey(t *testing.T) {
	// Раскладка файлов на диске — внутреннее дело сервера.
	userID, channelID := uuid.New(), uuid.New()
	uc := new(MockAttachmentUseCase)
	uc.On("Upload", mock.Anything).Return(&domain.Attachment{
		ID: uuid.New(), Kind: domain.AttachmentKindFile, StorageKey: "attachments/secret/path.bin",
	}, nil)

	rec := httptest.NewRecorder()
	newAttachmentHandler(uc).Upload(rec, newUploadRequest(t, channelID, "a.bin", []byte("data"), userID))

	assert.NotContains(t, rec.Body.String(), "attachments/secret/path.bin")
}

func TestUploadPassesSanitizedInputToUseCase(t *testing.T) {
	userID, channelID := uuid.New(), uuid.New()
	uc := new(MockAttachmentUseCase)
	uc.On("Upload", mock.MatchedBy(func(in domain.AttachmentUpload) bool {
		return in.ChannelID == channelID && in.UserID == userID && in.Size == 11
	})).Return(&domain.Attachment{ID: uuid.New(), Kind: domain.AttachmentKindFile}, nil)

	rec := httptest.NewRecorder()
	newAttachmentHandler(uc).Upload(rec, newUploadRequest(t, channelID, "a.bin", []byte("hello world"), userID))

	require.Equal(t, http.StatusCreated, rec.Code)
	uc.AssertExpectations(t)
}

func TestUploadRejectsMissingChannelID(t *testing.T) {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	part, err := w.CreateFormFile("file", "a.bin")
	require.NoError(t, err)
	_, _ = part.Write([]byte("data"))
	require.NoError(t, w.Close())
	req := httptest.NewRequest(http.MethodPost, "/api/v1/attachments", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req = req.WithContext(context.WithValue(req.Context(), "user_id", uuid.New()))

	rec := httptest.NewRecorder()
	newAttachmentHandler(new(MockAttachmentUseCase)).Upload(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "invalid_channel_id")
}

func TestUploadRejectsMissingFilePart(t *testing.T) {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	require.NoError(t, w.WriteField("channel_id", uuid.New().String()))
	require.NoError(t, w.Close())
	req := httptest.NewRequest(http.MethodPost, "/api/v1/attachments", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req = req.WithContext(context.WithValue(req.Context(), "user_id", uuid.New()))

	rec := httptest.NewRecorder()
	newAttachmentHandler(new(MockAttachmentUseCase)).Upload(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "attachment_required")
}

func TestUploadMapsTooLargeTo413(t *testing.T) {
	userID, channelID := uuid.New(), uuid.New()
	uc := new(MockAttachmentUseCase)
	uc.On("Upload", mock.Anything).Return(nil, domain.ErrAttachmentTooLarge)

	rec := httptest.NewRecorder()
	newAttachmentHandler(uc).Upload(rec, newUploadRequest(t, channelID, "big.bin", []byte("data"), userID))

	assert.Equal(t, http.StatusRequestEntityTooLarge, rec.Code)
	assert.Contains(t, rec.Body.String(), "attachment_too_large")
}

func TestUploadMapsForbiddenTo403(t *testing.T) {
	userID, channelID := uuid.New(), uuid.New()
	uc := new(MockAttachmentUseCase)
	uc.On("Upload", mock.Anything).Return(nil, domain.ErrForbidden)

	rec := httptest.NewRecorder()
	newAttachmentHandler(uc).Upload(rec, newUploadRequest(t, channelID, "a.bin", []byte("data"), userID))

	assert.Equal(t, http.StatusForbidden, rec.Code)
}

func TestDeleteMapsAlreadyAttachedTo409(t *testing.T) {
	userID, attID := uuid.New(), uuid.New()
	uc := new(MockAttachmentUseCase)
	uc.On("Delete", attID, userID).Return(domain.ErrAttachmentAlreadyAttached)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/attachments/"+attID.String(), nil)
	req.SetPathValue("id", attID.String())
	req = req.WithContext(context.WithValue(req.Context(), "user_id", userID))

	rec := httptest.NewRecorder()
	newAttachmentHandler(uc).Delete(rec, req)

	assert.Equal(t, http.StatusConflict, rec.Code)
	assert.Contains(t, rec.Body.String(), "attachment_already_attached")
}

func TestGetReturnsFreshSignedURL(t *testing.T) {
	// Этим клиент обновляет протухшую ссылку, не перезагружая страницу.
	userID, attID := uuid.New(), uuid.New()
	uc := new(MockAttachmentUseCase)
	uc.On("GetForUser", attID, userID).Return(&domain.Attachment{ID: attID, Kind: domain.AttachmentKindImage}, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/attachments/"+attID.String(), nil)
	req.SetPathValue("id", attID.String())
	req = req.WithContext(context.WithValue(req.Context(), "user_id", userID))

	rec := httptest.NewRecorder()
	newAttachmentHandler(uc).Get(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	var got domain.Attachment
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &got))
	assert.Contains(t, got.URL, "sig=")
}

func countTempUploads(t *testing.T) int {
	t.Helper()
	matches, err := filepath.Glob(filepath.Join(os.TempDir(), "vycord-upload-*"))
	require.NoError(t, err)
	return len(matches)
}

func TestUploadRejectsSecondFilePartAndLeavesNoTempFiles(t *testing.T) {
	// У multipart нет запрета на повторяющиеся имена полей, а defer видит
	// только последнее значение tmp — без явного отказа первый временный файл
	// остался бы на диске навсегда.
	before := countTempUploads(t)

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	require.NoError(t, w.WriteField("channel_id", uuid.New().String()))
	p1, err := w.CreateFormFile("file", "a.bin")
	require.NoError(t, err)
	_, _ = p1.Write([]byte("first"))
	p2, err := w.CreateFormFile("file", "b.bin")
	require.NoError(t, err)
	_, _ = p2.Write([]byte("second"))
	require.NoError(t, w.Close())

	req := httptest.NewRequest(http.MethodPost, "/api/v1/attachments", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req = req.WithContext(context.WithValue(req.Context(), "user_id", uuid.New()))

	rec := httptest.NewRecorder()
	newAttachmentHandler(new(MockAttachmentUseCase)).Upload(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Equal(t, before, countTempUploads(t), "временные файлы не должны оставаться на диске")
}

func TestUploadRejectsFileBeforeChannelID(t *testing.T) {
	// Иначе сервер запишет весь файл на диск прежде, чем проверит UUID.
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	part, err := w.CreateFormFile("file", "a.bin")
	require.NoError(t, err)
	_, _ = part.Write([]byte("payload"))
	require.NoError(t, w.WriteField("channel_id", uuid.New().String()))
	require.NoError(t, w.Close())

	req := httptest.NewRequest(http.MethodPost, "/api/v1/attachments", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req = req.WithContext(context.WithValue(req.Context(), "user_id", uuid.New()))

	rec := httptest.NewRecorder()
	newAttachmentHandler(new(MockAttachmentUseCase)).Upload(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "invalid_channel_id")
}

func TestUploadEnforcesRawBodyLimit(t *testing.T) {
	// Предохранитель на сырое тело: настоящий лимит файла живёт в тарифном
	// плане, но этот тоже должен срабатывать и не иметь off-by-one.
	//
	// Сравниваем счётчик temp-файлов до и после запроса (а не разность двух
	// вызовов подряд, которая всегда равна нулю): интересует не сам факт
	// отказа, а то, что отказ не оставляет мусора на диске.
	signer := attachlink.NewSigner("test-secret", time.Hour)
	h := handler.NewAttachmentHandler(new(MockAttachmentUseCase), newQuotaMock(testDefaultMaxFileBytes), signer, 16, slog.Default())
	before := countTempUploads(t)

	rec := httptest.NewRecorder()
	h.Upload(rec, newUploadRequest(t, uuid.New(), "big.bin", bytes.Repeat([]byte("x"), 64), uuid.New()))

	assert.Contains(t, []int{http.StatusRequestEntityTooLarge, http.StatusBadRequest}, rec.Code)
	assert.Equal(t, before, countTempUploads(t), "временные файлы не должны оставаться на диске")
}

func TestUploadRejectsContentLengthOverLimitBeforeReadingBody(t *testing.T) {
	// I6: заявленная длина заведомо больше лимита плана (даже с запасом на
	// конверт) — отказ должен случиться до r.MultipartReader(), не тронув ни
	// диск, ни usecase.
	before := countTempUploads(t)
	uc := new(MockAttachmentUseCase)
	quota := newQuotaMock(100)
	signer := attachlink.NewSigner("test-secret", time.Hour)
	h := handler.NewAttachmentHandler(uc, quota, signer, 30<<20, slog.Default())

	req := newUploadRequest(t, uuid.New(), "big.bin", bytes.Repeat([]byte("x"), 10_000), uuid.New())

	rec := httptest.NewRecorder()
	h.Upload(rec, req)

	assert.Equal(t, http.StatusRequestEntityTooLarge, rec.Code)
	assert.Contains(t, rec.Body.String(), "attachment_too_large")
	assert.Equal(t, before, countTempUploads(t), "временные файлы не должны оставаться на диске")
	uc.AssertNotCalled(t, "Upload", mock.Anything)
}

func TestUploadDrainsBodyBeforeEarlyContentLengthReject(t *testing.T) {
	// Регрессия прод-инцидента: ранний 413 отвечал и возвращал управление, не
	// дочитав тело запроса. net/http после выхода из хендлера дренирует лишь
	// небольшой хвост недочитанного тела и закрывает соединение — а nginx в
	// этот момент ещё дописывает тело наверх, ловит обрыв и отдаёт клиенту
	// свой 502 вместо нашего честного 413. Проверяем на уровне юнит-теста
	// наблюдаемое следствие дренажа: после возврата из Upload тело запроса
	// должно быть прочитано до конца.
	before := countTempUploads(t)
	uc := new(MockAttachmentUseCase)
	quota := newQuotaMock(100)
	signer := attachlink.NewSigner("test-secret", time.Hour)
	h := handler.NewAttachmentHandler(uc, quota, signer, 30<<20, slog.Default())

	req := newUploadRequest(t, uuid.New(), "big.bin", bytes.Repeat([]byte("x"), 10_000), uuid.New())

	rec := httptest.NewRecorder()
	h.Upload(rec, req)

	assert.Equal(t, http.StatusRequestEntityTooLarge, rec.Code)
	assert.Equal(t, before, countTempUploads(t), "временные файлы не должны оставаться на диске")

	remaining, err := io.ReadAll(req.Body)
	require.NoError(t, err)
	assert.Empty(t, remaining, "тело запроса должно быть дочитано до конца перед ранним отказом")
}

func TestUploadDrainsBodyBeforeInvalidChannelIDReject(t *testing.T) {
	// Самый реалистичный из "проглоченных" случаев: невалидный UUID в
	// channel_id, а следом в конверте — крупная файловая часть. part.Close()
	// дренирует только текущую часть multipart, а не остаток тела; без
	// явного h.drainBody(r) файловая часть остаётся непрочитанной целиком, и
	// на реальном соединении это тот же обрыв и 502 от nginx вместо нашего
	// честного 400.
	before := countTempUploads(t)
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	require.NoError(t, w.WriteField("channel_id", "not-a-uuid"))
	part, err := w.CreateFormFile("file", "big.bin")
	require.NoError(t, err)
	_, err = part.Write(bytes.Repeat([]byte("x"), 10_000))
	require.NoError(t, err)
	require.NoError(t, w.Close())

	req := httptest.NewRequest(http.MethodPost, "/api/v1/attachments", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req = req.WithContext(context.WithValue(req.Context(), "user_id", uuid.New()))

	rec := httptest.NewRecorder()
	newAttachmentHandler(new(MockAttachmentUseCase)).Upload(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "invalid_channel_id")
	assert.Equal(t, before, countTempUploads(t), "временные файлы не должны оставаться на диске")

	remaining, err := io.ReadAll(req.Body)
	require.NoError(t, err)
	assert.Empty(t, remaining, "тело запроса должно быть дочитано до конца перед ранним отказом")
}

func TestUploadContentLengthUnknownSkipsEarlyCheck(t *testing.T) {
	// Chunked-передача без заявленной длины (ContentLength == -1): ранней
	// проверки просто нет — обычная загрузка не должна из-за этого сломаться,
	// а точную проверку сделает поздний путь.
	userID, channelID := uuid.New(), uuid.New()
	attID := uuid.New()
	uc := new(MockAttachmentUseCase)
	uc.On("Upload", mock.Anything).Return(&domain.Attachment{ID: attID, Kind: domain.AttachmentKindFile}, nil)
	// Лимит нарочно маленький: сработай ранняя проверка вопреки
	// ContentLength == -1, получили бы 413 не по адресу.
	quota := newQuotaMock(100)

	req := newUploadRequest(t, channelID, "a.bin", []byte("hello"), userID)
	req.ContentLength = -1

	signer := attachlink.NewSigner("test-secret", time.Hour)
	h := handler.NewAttachmentHandler(uc, quota, signer, 30<<20, slog.Default())
	rec := httptest.NewRecorder()
	h.Upload(rec, req)

	assert.Equal(t, http.StatusCreated, rec.Code)
	quota.AssertNotCalled(t, "For", mock.Anything)
}

func TestUploadAllowsFileNearLimitDespiteEnvelopeOverhead(t *testing.T) {
	// Файл сам по себе не превышает лимит, но ContentLength (файл + границы
	// частей + их заголовки + поле channel_id) вылезает за лимит на десятки
	// байт. Наивная проверка "ContentLength > лимит" забраковала бы такую
	// валидную загрузку; проверка с запасом на конверт обязана её пропустить.
	userID, channelID := uuid.New(), uuid.New()
	attID := uuid.New()
	fileSize := 1000
	content := bytes.Repeat([]byte("y"), fileSize)

	uc := new(MockAttachmentUseCase)
	uc.On("Upload", mock.MatchedBy(func(in domain.AttachmentUpload) bool {
		return in.Size == int64(fileSize)
	})).Return(&domain.Attachment{ID: attID, Kind: domain.AttachmentKindFile}, nil)
	quota := newQuotaMock(int64(fileSize)) // лимит равен размеру файла впритык

	req := newUploadRequest(t, channelID, "near-limit.bin", content, userID)
	// Sanity-check самого теста: без конверта, вылезающего за лимит, тест не
	// проверял бы ничего интересного.
	require.Greater(t, req.ContentLength, int64(fileSize))

	signer := attachlink.NewSigner("test-secret", time.Hour)
	h := handler.NewAttachmentHandler(uc, quota, signer, 30<<20, slog.Default())
	rec := httptest.NewRecorder()
	h.Upload(rec, req)

	assert.Equal(t, http.StatusCreated, rec.Code)
	uc.AssertExpectations(t)
}
