package handler

import (
	"bytes"
	"encoding/json"
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

// Регрессия I-A: Login — как и GetMe — это ответ про "мой собственный
// профиль". Раньше LoginResponse.User сериализовал *domain.User напрямую,
// поэтому после фикса C2 (json:"-" на AllowFriendRequests/AllowDMFrom) эти
// поля молча переставали приходить и в ответ на логин — клиентские дропдауны
// приватности откатывались на дефолты при каждой новой сессии.
func TestAuthHandler_Login_IncludesPrivacySettings(t *testing.T) {
	log := slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil))
	mockUC := new(mockAuthUseCase)
	user := &domain.User{
		Username:            "testuser",
		AllowFriendRequests: domain.PrivacyMode("mutual_servers"),
		AllowDMFrom:         domain.PrivacyMode("none"),
	}
	mockUC.On("Login", "u@e.com", "password123").Return(user, "access-token", "refresh-token", nil)

	h := NewAuthHandler(mockUC, log)

	body := strings.NewReader(`{"email":"u@e.com","password":"password123"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", body)
	rec := httptest.NewRecorder()

	h.Login(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		User struct {
			AllowFriendRequests string `json:"allow_friend_requests"`
			AllowDMFrom         string `json:"allow_dm_from"`
		} `json:"user"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if resp.User.AllowFriendRequests != "mutual_servers" {
		t.Fatalf("expected allow_friend_requests=mutual_servers, got %q (body: %s)", resp.User.AllowFriendRequests, rec.Body.String())
	}
	if resp.User.AllowDMFrom != "none" {
		t.Fatalf("expected allow_dm_from=none, got %q (body: %s)", resp.User.AllowDMFrom, rec.Body.String())
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
