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
	return handler.NewAttachmentHandler(uc, signer, 30<<20, slog.Default())
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
	h := handler.NewAttachmentHandler(new(MockAttachmentUseCase), signer, 16, slog.Default())
	before := countTempUploads(t)

	rec := httptest.NewRecorder()
	h.Upload(rec, newUploadRequest(t, uuid.New(), "big.bin", bytes.Repeat([]byte("x"), 64), uuid.New()))

	assert.Contains(t, []int{http.StatusRequestEntityTooLarge, http.StatusBadRequest}, rec.Code)
	assert.Equal(t, before, countTempUploads(t), "временные файлы не должны оставаться на диске")
}
