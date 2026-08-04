package handler

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/mock"

	"github.com/vycord/server/internal/delivery/http/middleware"
	"github.com/vycord/server/internal/domain"
)

type mockVoiceTokenUseCase struct{ mock.Mock }

func (m *mockVoiceTokenUseCase) IssueToken(channelID, userID uuid.UUID) (string, error) {
	args := m.Called(channelID, userID)
	return args.String(0), args.Error(1)
}

func TestVoiceTokenHandler_IssueToken_Success(t *testing.T) {
	log := slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil))

	mockUC := new(mockVoiceTokenUseCase)
	channelID := uuid.New()
	userID := uuid.New()
	mockUC.On("IssueToken", channelID, userID).Return("signed-token", nil)

	h := NewVoiceTokenHandler(mockUC, log)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/channels/"+channelID.String()+"/voice-token", nil)
	req.SetPathValue("channel_id", channelID.String())
	req = req.WithContext(context.WithValue(req.Context(), "user_id", userID))

	rec := httptest.NewRecorder()
	h.IssueToken(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "signed-token") {
		t.Fatalf("expected response to contain the token, got: %s", rec.Body.String())
	}
}

func TestVoiceTokenHandler_IssueToken_Forbidden(t *testing.T) {
	log := slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil))

	mockUC := new(mockVoiceTokenUseCase)
	channelID := uuid.New()
	userID := uuid.New()
	mockUC.On("IssueToken", channelID, userID).Return("", domain.ErrChannelForbidden)

	h := NewVoiceTokenHandler(mockUC, log)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/channels/"+channelID.String()+"/voice-token", nil)
	req.SetPathValue("channel_id", channelID.String())
	req = req.WithContext(context.WithValue(req.Context(), "user_id", userID))

	rec := httptest.NewRecorder()
	h.IssueToken(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", rec.Code)
	}
}

func TestVoiceTokenHandler_IssueToken_LogsRequestIDOnInternalError(t *testing.T) {
	var buf bytes.Buffer
	log := slog.New(slog.NewTextHandler(&buf, nil))

	mockUC := new(mockVoiceTokenUseCase)
	channelID := uuid.New()
	userID := uuid.New()
	mockUC.On("IssueToken", channelID, userID).Return("", errors.New("signing failed"))

	h := NewVoiceTokenHandler(mockUC, log)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/channels/"+channelID.String()+"/voice-token", nil)
	req.SetPathValue("channel_id", channelID.String())
	req = req.WithContext(context.WithValue(req.Context(), "user_id", userID))

	rec := httptest.NewRecorder()
	chain := middleware.RequestID(http.HandlerFunc(h.IssueToken))
	chain.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", rec.Code)
	}
	headerID := rec.Header().Get(middleware.RequestIDHeader)
	if headerID == "" || !strings.Contains(buf.String(), "request_id="+headerID) {
		t.Fatalf("expected error log to contain request_id=%s, got: %s", headerID, buf.String())
	}
}
