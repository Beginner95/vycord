package handler

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/mock"

	"github.com/vycord/server/internal/delivery/http/middleware"
	"github.com/vycord/server/internal/delivery/ws"
	"github.com/vycord/server/internal/domain"
)

func TestUserHandler_UpdateLastVisited_LogsRequestIDOnError(t *testing.T) {
	var buf bytes.Buffer
	log := slog.New(slog.NewTextHandler(&buf, nil))

	mockUC := new(mockUserUseCase)
	userID := uuid.New()
	mockUC.On("UpdateLastVisited", userID, (*uuid.UUID)(nil), (*uuid.UUID)(nil)).Return(errors.New("db down"))

	hub := ws.NewHub(log)
	h := NewUserHandler(mockUC, hub, log)

	req := httptest.NewRequest(http.MethodPut, "/api/v1/users/me/last-visited", strings.NewReader(`{}`))
	req = req.WithContext(context.WithValue(req.Context(), "user_id", userID))

	rec := httptest.NewRecorder()
	chain := middleware.RequestID(http.HandlerFunc(h.UpdateLastVisited))
	chain.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", rec.Code)
	}

	headerID := rec.Header().Get(middleware.RequestIDHeader)
	if headerID == "" {
		t.Fatal("expected X-Request-Id header to be set")
	}
	if !strings.Contains(buf.String(), "request_id="+headerID) {
		t.Fatalf("expected error log to contain request_id=%s, got: %s", headerID, buf.String())
	}
}

func multipartAvatarBody(t *testing.T, filename string, content []byte) (*bytes.Buffer, string) {
	t.Helper()
	buf := &bytes.Buffer{}
	w := multipart.NewWriter(buf)
	part, err := w.CreateFormFile("avatar", filename)
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

func TestUserHandler_UploadAvatar_Success(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	hub := ws.NewHub(log)
	go hub.Run()

	mockUC := new(mockUserUseCase)
	userID := uuid.New()
	avatarURL := "/uploads/avatars/new.png"
	updated := &domain.User{ID: userID, Username: "alice", AvatarURL: &avatarURL}
	mockUC.On("UpdateAvatar", userID, mock.Anything).Return(updated, nil)

	h := NewUserHandler(mockUC, hub, log)

	body, contentType := multipartAvatarBody(t, "avatar.png", []byte("fake-png-bytes"))
	req := httptest.NewRequest(http.MethodPost, "/api/v1/users/me/avatar", body)
	req.Header.Set("Content-Type", contentType)
	req = req.WithContext(context.WithValue(req.Context(), "user_id", userID))

	rec := httptest.NewRecorder()
	h.UploadAvatar(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	mockUC.AssertExpectations(t)
}

func TestUserHandler_UploadAvatar_RejectsOversizedFile(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	hub := ws.NewHub(log)
	mockUC := new(mockUserUseCase)
	h := NewUserHandler(mockUC, hub, log)

	// 2.5MB: over the 2MB file limit, but under the 3MB wire cap — exercises
	// the application-level size check, not the http.MaxBytesReader backstop.
	oversized := make([]byte, int(2.5*1024*1024))
	body, contentType := multipartAvatarBody(t, "avatar.png", oversized)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/users/me/avatar", body)
	req.Header.Set("Content-Type", contentType)
	req = req.WithContext(context.WithValue(req.Context(), "user_id", uuid.New()))

	rec := httptest.NewRecorder()
	h.UploadAvatar(rec, req)

	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413, got %d: %s", rec.Code, rec.Body.String())
	}
	mockUC.AssertNotCalled(t, "UpdateAvatar", mock.Anything, mock.Anything)
}

func TestUserHandler_UploadAvatar_RejectsMissingFile(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	hub := ws.NewHub(log)
	mockUC := new(mockUserUseCase)
	h := NewUserHandler(mockUC, hub, log)

	buf := &bytes.Buffer{}
	w := multipart.NewWriter(buf)
	_ = w.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/users/me/avatar", buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req = req.WithContext(context.WithValue(req.Context(), "user_id", uuid.New()))

	rec := httptest.NewRecorder()
	h.UploadAvatar(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestUserHandler_UploadAvatar_TranslatesUnsupportedFormatError(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	hub := ws.NewHub(log)
	mockUC := new(mockUserUseCase)
	userID := uuid.New()
	mockUC.On("UpdateAvatar", userID, mock.Anything).Return(nil, domain.ErrUnsupportedAvatarFormat)

	h := NewUserHandler(mockUC, hub, log)

	body, contentType := multipartAvatarBody(t, "avatar.png", []byte("not really a png"))
	req := httptest.NewRequest(http.MethodPost, "/api/v1/users/me/avatar", body)
	req.Header.Set("Content-Type", contentType)
	req = req.WithContext(context.WithValue(req.Context(), "user_id", userID))

	rec := httptest.NewRecorder()
	h.UploadAvatar(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestUserHandler_RemoveAvatar_Success(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	hub := ws.NewHub(log)
	go hub.Run()

	mockUC := new(mockUserUseCase)
	userID := uuid.New()
	updated := &domain.User{ID: userID, Username: "alice"}
	mockUC.On("RemoveAvatar", userID).Return(updated, nil)

	h := NewUserHandler(mockUC, hub, log)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/users/me/avatar", nil)
	req = req.WithContext(context.WithValue(req.Context(), "user_id", userID))

	rec := httptest.NewRecorder()
	h.RemoveAvatar(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	mockUC.AssertExpectations(t)
}
