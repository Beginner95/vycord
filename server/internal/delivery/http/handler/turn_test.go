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

type mockTURNUseCase struct{ mock.Mock }

func (m *mockTURNUseCase) GetCredentials(userID uuid.UUID) (*domain.TURNCredentials, error) {
	args := m.Called(userID)
	c, _ := args.Get(0).(*domain.TURNCredentials)
	return c, args.Error(1)
}

func TestTURNHandler_GetCredentials_LogsRequestIDOnError(t *testing.T) {
	var buf bytes.Buffer
	log := slog.New(slog.NewTextHandler(&buf, nil))

	mockUC := new(mockTURNUseCase)
	userID := uuid.New()
	mockUC.On("GetCredentials", userID).Return(nil, errors.New("turn secret not configured"))

	h := NewTURNHandler(mockUC, log)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/turn/credentials", nil)
	req = req.WithContext(context.WithValue(req.Context(), "user_id", userID))

	rec := httptest.NewRecorder()
	chain := middleware.RequestID(http.HandlerFunc(h.GetCredentials))
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
