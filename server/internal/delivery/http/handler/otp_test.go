package handler

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/mock"
	"github.com/vycord/server/internal/domain"
)

type mockOTPUseCase struct{ mock.Mock }

func (m *mockOTPUseCase) RequestCode(email string, p domain.OTPPurpose) error {
	return m.Called(email, p).Error(0)
}

func (m *mockOTPUseCase) VerifyCode(email, code string, p domain.OTPPurpose) (*domain.User, string, string, error) {
	args := m.Called(email, code, p)
	if args.Get(0) == nil {
		return nil, "", "", args.Error(3)
	}
	return args.Get(0).(*domain.User), args.String(1), args.String(2), args.Error(3)
}

func newOTPHandler(uc *mockOTPUseCase) *OTPHandler {
	return NewOTPHandler(uc, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
}

func TestRequestLoginCodeReturns202(t *testing.T) {
	uc := new(mockOTPUseCase)
	uc.On("RequestCode", "u@e.com", domain.OTPPurposeLogin).Return(nil)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/otp/request", strings.NewReader(`{"email":"u@e.com"}`))
	rec := httptest.NewRecorder()
	newOTPHandler(uc).RequestLoginCode(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestRequestCodeCooldownReturns429WithRetryAfter(t *testing.T) {
	uc := new(mockOTPUseCase)
	uc.On("RequestCode", "u@e.com", domain.OTPPurposeLogin).
		Return(&domain.OTPThrottledError{RetryAfter: 45 * time.Second})

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/otp/request", strings.NewReader(`{"email":"u@e.com"}`))
	rec := httptest.NewRecorder()
	newOTPHandler(uc).RequestLoginCode(rec, req)

	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429, got %d", rec.Code)
	}
	if got := rec.Header().Get("Retry-After"); got != "45" {
		t.Fatalf("expected Retry-After: 45, got %q", got)
	}
	if !strings.Contains(rec.Body.String(), "otp_cooldown") {
		t.Fatalf("expected otp_cooldown code, got: %s", rec.Body.String())
	}
}

func TestVerifyRejectsMalformedCode(t *testing.T) {
	uc := new(mockOTPUseCase)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/otp/verify", strings.NewReader(`{"email":"u@e.com","code":"12a4"}`))
	rec := httptest.NewRecorder()
	newOTPHandler(uc).VerifyLogin(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "invalid_otp_format") {
		t.Fatalf("expected invalid_otp_format, got: %s", rec.Body.String())
	}
	uc.AssertNotCalled(t, "VerifyCode", mock.Anything, mock.Anything, mock.Anything)
}

func TestVerifyWrongCodeReturns401WithAttemptsLeft(t *testing.T) {
	uc := new(mockOTPUseCase)
	uc.On("VerifyCode", "u@e.com", "9999", domain.OTPPurposeLogin).
		Return(nil, "", "", &domain.OTPAttemptError{AttemptsLeft: 2})

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/otp/verify", strings.NewReader(`{"email":"u@e.com","code":"9999"}`))
	rec := httptest.NewRecorder()
	newOTPHandler(uc).VerifyLogin(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "invalid_otp") || !strings.Contains(body, `"attempts_left":2`) {
		t.Fatalf("expected invalid_otp with attempts_left, got: %s", body)
	}
}

func TestVerifyRegistrationSuccessReturns201(t *testing.T) {
	uc := new(mockOTPUseCase)
	uc.On("VerifyCode", "u@e.com", "0429", domain.OTPPurposeRegistration).
		Return(&domain.User{Username: "u"}, "access", "refresh", nil)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register/verify", strings.NewReader(`{"email":"u@e.com","code":"0429"}`))
	rec := httptest.NewRecorder()
	newOTPHandler(uc).VerifyRegistration(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "access") {
		t.Fatalf("expected tokens in body, got: %s", rec.Body.String())
	}
}
