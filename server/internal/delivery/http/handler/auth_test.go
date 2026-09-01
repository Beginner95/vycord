package handler

import (
	"bytes"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

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

func TestAuthHandler_Login_EmailNotVerified_Returns403(t *testing.T) {
	// Верные креды, но почта не подтверждена: должно быть 403 с
	// machine-readable кодом email_not_verified, а не 401 internal_error —
	// иначе клиент не сможет отличить этот случай от неверного пароля.
	log := slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil))
	mockUC := new(mockAuthUseCase)
	mockUC.On("Login", "u@e.com", "password123").Return(nil, "", "", domain.ErrEmailNotVerified)

	h := NewAuthHandler(mockUC, log)

	body := strings.NewReader(`{"email":"u@e.com","password":"password123"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", body)
	rec := httptest.NewRecorder()

	h.Login(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "email_not_verified") {
		t.Fatalf("expected machine-readable code in body, got: %s", rec.Body.String())
	}
}

// Регистрация на брошенный неподтверждённый адрес запрашивает код и упирается
// в тот же кулдаун, что и /otp/request. Это рутинный 429, а не сбой сервера:
// без явной ветки OTPThrottledError проваливался в default и отдавался как
// 500 с ERROR в логах.
func TestAuthHandler_Register_Throttled_Returns429WithRetryAfter(t *testing.T) {
	log := slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil))
	mockUC := new(mockAuthUseCase)
	mockUC.On("Register", "newname", "same@e.com", "password123").
		Return(nil, &domain.OTPThrottledError{RetryAfter: 45 * time.Second})

	h := NewAuthHandler(mockUC, log)

	body := strings.NewReader(`{"username":"newname","email":"same@e.com","password":"password123"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", body)
	rec := httptest.NewRecorder()

	h.Register(rec, req)

	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429, got %d: %s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Retry-After"); got != "45" {
		t.Fatalf("expected Retry-After: 45, got %q", got)
	}
	if !strings.Contains(rec.Body.String(), "otp_cooldown") {
		t.Fatalf("expected otp_cooldown code, got: %s", rec.Body.String())
	}
}

// Часовой потолок отличается от кулдауна кодом ошибки — клиент показывает
// разные тексты, и Register не должен схлопывать их в один.
func TestAuthHandler_Register_HourlyLimit_ReturnsRateLimitedCode(t *testing.T) {
	log := slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil))
	mockUC := new(mockAuthUseCase)
	mockUC.On("Register", "newname", "same@e.com", "password123").
		Return(nil, &domain.OTPThrottledError{RetryAfter: time.Hour, Hourly: true})

	h := NewAuthHandler(mockUC, log)

	body := strings.NewReader(`{"username":"newname","email":"same@e.com","password":"password123"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", body)
	rec := httptest.NewRecorder()

	h.Register(rec, req)

	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429, got %d: %s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Retry-After"); got != "3600" {
		t.Fatalf("expected Retry-After: 3600, got %q", got)
	}
	if !strings.Contains(rec.Body.String(), "otp_rate_limited") {
		t.Fatalf("expected otp_rate_limited code, got: %s", rec.Body.String())
	}
}
