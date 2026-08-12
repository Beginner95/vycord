package handler

import (
	"bytes"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/vycord/server/internal/domain"
)

func TestAuthHandler_Refresh_Success(t *testing.T) {
	log := slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil))
	mockUC := new(mockAuthUseCase)
	user := &domain.User{Username: "testuser"}
	mockUC.On("Refresh", "old-refresh-token").Return(user, "new-access-token", "new-refresh-token", nil)

	h := NewAuthHandler(mockUC, log)

	body := strings.NewReader(`{"refresh_token":"old-refresh-token"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/refresh", body)
	rec := httptest.NewRecorder()

	h.Refresh(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	respBody := rec.Body.String()
	if !strings.Contains(respBody, "new-access-token") || !strings.Contains(respBody, "new-refresh-token") {
		t.Fatalf("expected response to contain both new tokens, got: %s", respBody)
	}
}

func TestAuthHandler_Refresh_InvalidToken(t *testing.T) {
	log := slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil))
	mockUC := new(mockAuthUseCase)
	mockUC.On("Refresh", "bad-token").Return(nil, "", "", domain.ErrRefreshTokenInvalid)

	h := NewAuthHandler(mockUC, log)

	body := strings.NewReader(`{"refresh_token":"bad-token"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/refresh", body)
	rec := httptest.NewRecorder()

	h.Refresh(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "invalid_or_expired_token") {
		t.Fatalf("expected machine-readable code in body, got: %s", rec.Body.String())
	}
}

func TestAuthHandler_Refresh_UnexpectedError_Returns500NotUnauthorized(t *testing.T) {
	// Инфраструктурный сбой (БД недоступна и т.п.) не должен выглядеть как
	// «сессия истекла» — иначе клиент разлогинит пользователя из-за
	// временного сбоя сервера (см. VYC-54).
	log := slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil))
	mockUC := new(mockAuthUseCase)
	mockUC.On("Refresh", "some-token").Return(nil, "", "", errors.New("db unavailable"))

	h := NewAuthHandler(mockUC, log)

	body := strings.NewReader(`{"refresh_token":"some-token"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/refresh", body)
	rec := httptest.NewRecorder()

	h.Refresh(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", rec.Code)
	}
}

func TestAuthHandler_Logout_Success(t *testing.T) {
	log := slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil))
	mockUC := new(mockAuthUseCase)
	mockUC.On("Logout", "some-refresh-token").Return(nil)

	h := NewAuthHandler(mockUC, log)

	body := strings.NewReader(`{"refresh_token":"some-refresh-token"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", body)
	rec := httptest.NewRecorder()

	h.Logout(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", rec.Code)
	}
	mockUC.AssertExpectations(t)
}

func TestAuthHandler_Logout_MalformedBody_StillReturns204(t *testing.T) {
	log := slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil))
	mockUC := new(mockAuthUseCase)

	h := NewAuthHandler(mockUC, log)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", strings.NewReader(`not json`))
	rec := httptest.NewRecorder()

	h.Logout(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", rec.Code)
	}
}
