package usecase_test

import (
	"errors"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"

	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/internal/usecase"
)

func testPolicy() usecase.OTPPolicy {
	return usecase.OTPPolicy{
		Secret:         "test-otp-secret",
		TTL:            5 * time.Minute,
		MaxAttempts:    3,
		ResendCooldown: time.Minute,
		MaxPerHour:     5,
	}
}

// newOTPUseCase собирает юзкейс с моками. refreshRepo нужен только для
// выдачи пары токенов после успешной проверки.
func newOTPUseCase(t *testing.T) (domain.OTPUseCase, *MockUserRepository, *MockOTPRepository, *MockMailer, *MockRefreshTokenRepository) {
	t.Helper()
	userRepo := new(MockUserRepository)
	otpRepo := new(MockOTPRepository)
	mailer := new(MockMailer)
	refreshRepo := new(MockRefreshTokenRepository)
	uc := usecase.NewOTPUseCase(
		userRepo, otpRepo, mailer, refreshRepo,
		"jwt-secret", 15*time.Minute, 720*time.Hour,
		testPolicy(), slog.Default(),
	)
	return uc, userRepo, otpRepo, mailer, refreshRepo
}

func verifiedUser() *domain.User {
	at := time.Now().Add(-24 * time.Hour)
	return &domain.User{ID: uuid.New(), Username: "u", Email: "u@e.com", EmailVerifiedAt: &at}
}

func unverifiedUser() *domain.User {
	return &domain.User{ID: uuid.New(), Username: "u", Email: "u@e.com"}
}

func TestRequestCodeSendsMailAndStoresCode(t *testing.T) {
	uc, userRepo, otpRepo, mailer, _ := newOTPUseCase(t)
	user := verifiedUser()
	userRepo.On("GetByEmail", user.Email).Return(user, nil)
	otpRepo.On("LastIssuedAt", user.ID, domain.OTPPurposeLogin).Return(nil, nil)
	otpRepo.On("CountIssuedSince", user.ID, domain.OTPPurposeLogin, mock.Anything).Return(0, nil)
	otpRepo.On("InvalidateActive", user.ID, domain.OTPPurposeLogin).Return(nil)
	otpRepo.On("Create", mock.Anything).Return(nil)
	mailer.On("Send", mock.Anything).Return(nil)

	err := uc.RequestCode(user.Email, domain.OTPPurposeLogin)

	require.NoError(t, err)
	otpRepo.AssertCalled(t, "Create", mock.Anything)
	require.Len(t, mailer.Sent, 1)
	assert.Equal(t, user.Email, mailer.Sent[0].To)
}

// Сам код в БД не хранится — только HMAC, и он не равен коду из письма.
func TestRequestCodeStoresHashNotCode(t *testing.T) {
	uc, userRepo, otpRepo, mailer, _ := newOTPUseCase(t)
	user := verifiedUser()
	var stored *domain.OTPCode
	userRepo.On("GetByEmail", user.Email).Return(user, nil)
	otpRepo.On("LastIssuedAt", user.ID, domain.OTPPurposeLogin).Return(nil, nil)
	otpRepo.On("CountIssuedSince", user.ID, domain.OTPPurposeLogin, mock.Anything).Return(0, nil)
	otpRepo.On("InvalidateActive", user.ID, domain.OTPPurposeLogin).Return(nil)
	otpRepo.On("Create", mock.Anything).Run(func(args mock.Arguments) {
		stored = args.Get(0).(*domain.OTPCode)
	}).Return(nil)
	mailer.On("Send", mock.Anything).Return(nil)

	require.NoError(t, uc.RequestCode(user.Email, domain.OTPPurposeLogin))

	require.NotNil(t, stored)
	assert.Len(t, stored.CodeHash, 32, "HMAC-SHA256 это ровно 32 байта")
	assert.NotContains(t, string(stored.CodeHash), mailer.Sent[0].Text)
	assert.Equal(t, 0, stored.Attempts)
	assert.True(t, stored.ExpiresAt.After(time.Now()))
}

// Несуществующий email — тихий успех: ответ API не должен отличать
// «отправили» от «такого аккаунта нет».
func TestRequestCodeUnknownEmailSucceedsSilently(t *testing.T) {
	uc, userRepo, _, mailer, _ := newOTPUseCase(t)
	userRepo.On("GetByEmail", "nobody@e.com").Return(nil, errors.New("user not found"))

	err := uc.RequestCode("nobody@e.com", domain.OTPPurposeLogin)

	require.NoError(t, err)
	assert.Empty(t, mailer.Sent)
}

// Вход по коду неподтверждённому не положен, и письма он не получает.
func TestRequestLoginCodeForUnverifiedSendsNothing(t *testing.T) {
	uc, userRepo, _, mailer, _ := newOTPUseCase(t)
	user := unverifiedUser()
	userRepo.On("GetByEmail", user.Email).Return(user, nil)

	err := uc.RequestCode(user.Email, domain.OTPPurposeLogin)

	require.NoError(t, err)
	assert.Empty(t, mailer.Sent)
}

func TestRequestCodeCooldown(t *testing.T) {
	uc, userRepo, otpRepo, mailer, _ := newOTPUseCase(t)
	user := verifiedUser()
	justNow := time.Now().Add(-10 * time.Second)
	userRepo.On("GetByEmail", user.Email).Return(user, nil)
	otpRepo.On("LastIssuedAt", user.ID, domain.OTPPurposeLogin).Return(&justNow, nil)

	err := uc.RequestCode(user.Email, domain.OTPPurposeLogin)

	var throttled *domain.OTPThrottledError
	require.True(t, errors.As(err, &throttled))
	assert.False(t, throttled.Hourly)
	assert.Greater(t, throttled.RetryAfter, time.Duration(0))
	assert.Empty(t, mailer.Sent)
}

func TestRequestCodeHourlyLimit(t *testing.T) {
	uc, userRepo, otpRepo, mailer, _ := newOTPUseCase(t)
	user := verifiedUser()
	long := time.Now().Add(-10 * time.Minute)
	userRepo.On("GetByEmail", user.Email).Return(user, nil)
	otpRepo.On("LastIssuedAt", user.ID, domain.OTPPurposeLogin).Return(&long, nil)
	otpRepo.On("CountIssuedSince", user.ID, domain.OTPPurposeLogin, mock.Anything).Return(5, nil)

	err := uc.RequestCode(user.Email, domain.OTPPurposeLogin)

	var throttled *domain.OTPThrottledError
	require.True(t, errors.As(err, &throttled))
	assert.True(t, throttled.Hourly)
	assert.Empty(t, mailer.Sent)
}

// Выпуск нового кода гасит предыдущий: живой код всегда ровно один.
func TestRequestCodeInvalidatesPrevious(t *testing.T) {
	uc, userRepo, otpRepo, mailer, _ := newOTPUseCase(t)
	user := verifiedUser()
	long := time.Now().Add(-10 * time.Minute)
	userRepo.On("GetByEmail", user.Email).Return(user, nil)
	otpRepo.On("LastIssuedAt", user.ID, domain.OTPPurposeLogin).Return(&long, nil)
	otpRepo.On("CountIssuedSince", user.ID, domain.OTPPurposeLogin, mock.Anything).Return(1, nil)
	otpRepo.On("InvalidateActive", user.ID, domain.OTPPurposeLogin).Return(nil)
	otpRepo.On("Create", mock.Anything).Return(nil)
	mailer.On("Send", mock.Anything).Return(nil)

	require.NoError(t, uc.RequestCode(user.Email, domain.OTPPurposeLogin))

	otpRepo.AssertCalled(t, "InvalidateActive", user.ID, domain.OTPPurposeLogin)
}

// Сбой SMTP не откатывает код: он уже в БД и остаётся валидным, чтобы
// повторный запрос сработал.
func TestRequestCodeMailFailureKeepsCode(t *testing.T) {
	uc, userRepo, otpRepo, mailer, _ := newOTPUseCase(t)
	user := verifiedUser()
	userRepo.On("GetByEmail", user.Email).Return(user, nil)
	otpRepo.On("LastIssuedAt", user.ID, domain.OTPPurposeLogin).Return(nil, nil)
	otpRepo.On("CountIssuedSince", user.ID, domain.OTPPurposeLogin, mock.Anything).Return(0, nil)
	otpRepo.On("InvalidateActive", user.ID, domain.OTPPurposeLogin).Return(nil)
	otpRepo.On("Create", mock.Anything).Return(nil)
	mailer.On("Send", mock.Anything).Return(errors.New("smtp down"))

	err := uc.RequestCode(user.Email, domain.OTPPurposeLogin)

	assert.ErrorIs(t, err, domain.ErrMailSendFailed)
	otpRepo.AssertCalled(t, "Create", mock.Anything)
}
