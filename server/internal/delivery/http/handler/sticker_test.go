package handler

import (
	"bytes"
	"context"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"

	"github.com/vycord/server/internal/domain"
)

type MockStickerUseCase struct{ mock.Mock }

func (m *MockStickerUseCase) CreateSticker(serverID, userID uuid.UUID, name string, data []byte) (*domain.Sticker, error) {
	args := m.Called(serverID, userID, name, data)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*domain.Sticker), args.Error(1)
}

func (m *MockStickerUseCase) ListStickers(serverID, userID uuid.UUID) ([]*domain.Sticker, error) {
	args := m.Called(serverID, userID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).([]*domain.Sticker), args.Error(1)
}

func (m *MockStickerUseCase) DeleteSticker(serverID, stickerID, userID uuid.UUID) error {
	return m.Called(serverID, stickerID, userID).Error(0)
}

func setUserID(r *http.Request, uid uuid.UUID) *http.Request {
	ctx := context.WithValue(r.Context(), "user_id", uid)
	return r.WithContext(ctx)
}

func stickerCreateBody(t *testing.T, name string, content []byte) (*bytes.Buffer, string) {
	t.Helper()
	buf := &bytes.Buffer{}
	w := multipart.NewWriter(buf)
	if err := w.WriteField("name", name); err != nil {
		t.Fatalf("write name field: %v", err)
	}
	part, err := w.CreateFormFile("image", "s.png")
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	if _, err := part.Write(content); err != nil {
		t.Fatalf("write form file: %v", err)
	}
	if err := w.Close(); err != nil {
		t.Fatalf("close writer: %v", err)
	}
	return buf, w.FormDataContentType()
}

func TestStickerHandler_Create_Denied(t *testing.T) {
	uc := &MockStickerUseCase{}
	uc.On("CreateSticker", mock.Anything, mock.Anything, mock.Anything, mock.Anything).
		Return(nil, domain.ErrStickerForbidden)

	h := NewStickerHandler(uc, nil)

	body, contentType := stickerCreateBody(t, "hello", []byte("fake-png-bytes"))
	req := httptest.NewRequest(http.MethodPost, "/api/v1/servers/{id}/stickers", body)
	req.Header.Set("Content-Type", contentType)
	req.SetPathValue("id", uuid.New().String())
	req = setUserID(req, uuid.New())
	rec := httptest.NewRecorder()

	h.CreateSticker(rec, req)

	assert.Equal(t, http.StatusForbidden, rec.Code)
}