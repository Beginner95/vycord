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

// activeCode собирает живой код с корректным HMAC для заданного code.
// Хеш считается тем же способом, что и в юзкейсе, — иначе тест проверял бы
// не поведение, а собственную арифметику.
func activeCode(t *testing.T, user *domain.User, p domain.OTPPurpose, code string) *domain.OTPCode {
	t.Helper()
	return &domain.OTPCode{
		ID:        uuid.New(),
		UserID:    user.ID,
		Purpose:   p,
		CodeHash:  usecase.HashOTPCodeForTest(testPolicy().Secret, user.ID, p, code),
		CreatedAt: time.Now().Add(-time.Minute),
		ExpiresAt: time.Now().Add(4 * time.Minute),
	}
}

func TestVerifyRegistrationMarksVerifiedAndIssuesTokens(t *testing.T) {
	uc, userRepo, otpRepo, _, refreshRepo := newOTPUseCase(t)
	user := unverifiedUser()
	code := activeCode(t, user, domain.OTPPurposeRegistration, "0429")
	userRepo.On("GetByEmail", user.Email).Return(user, nil)
	otpRepo.On("GetActive", user.ID, domain.OTPPurposeRegistration).Return(code, nil)
	otpRepo.On("IncrementAttempts", code.ID, 3).Return(1, nil)
	otpRepo.On("Consume", code.ID, mock.Anything).Return(nil)
	userRepo.On("MarkEmailVerified", user.ID, mock.Anything).Return(nil)
	refreshRepo.On("Create", mock.Anything).Return(nil)

	got, access, refresh, err := uc.VerifyCode(user.Email, "0429", domain.OTPPurposeRegistration)

	require.NoError(t, err)
	assert.NotEmpty(t, access)
	assert.NotEmpty(t, refresh)
	assert.Equal(t, user.ID, got.ID)
	assert.Empty(t, got.Password, "хеш пароля не должен уезжать клиенту")
	userRepo.AssertCalled(t, "MarkEmailVerified", user.ID, mock.Anything)
}

func TestVerifyLoginDoesNotTouchVerifiedAt(t *testing.T) {
	uc, userRepo, otpRepo, _, refreshRepo := newOTPUseCase(t)
	user := verifiedUser()
	code := activeCode(t, user, domain.OTPPurposeLogin, "1234")
	userRepo.On("GetByEmail", user.Email).Return(user, nil)
	otpRepo.On("GetActive", user.ID, domain.OTPPurposeLogin).Return(code, nil)
	otpRepo.On("IncrementAttempts", code.ID, 3).Return(1, nil)
	otpRepo.On("Consume", code.ID, mock.Anything).Return(nil)
	refreshRepo.On("Create", mock.Anything).Return(nil)

	_, _, _, err := uc.VerifyCode(user.Email, "1234", domain.OTPPurposeLogin)

	require.NoError(t, err)
	userRepo.AssertNotCalled(t, "MarkEmailVerified", mock.Anything, mock.Anything)
}

func TestVerifyWrongCodeIncrementsAttempts(t *testing.T) {
	uc, userRepo, otpRepo, _, _ := newOTPUseCase(t)
	user := verifiedUser()
	code := activeCode(t, user, domain.OTPPurposeLogin, "1234")
	userRepo.On("GetByEmail", user.Email).Return(user, nil)
	otpRepo.On("GetActive", user.ID, domain.OTPPurposeLogin).Return(code, nil)
	otpRepo.On("IncrementAttempts", code.ID, 3).Return(1, nil)

	_, _, _, err := uc.VerifyCode(user.Email, "9999", domain.OTPPurposeLogin)

	assert.ErrorIs(t, err, domain.ErrOTPInvalid)
	var attemptErr *domain.OTPAttemptError
	require.True(t, errors.As(err, &attemptErr))
	assert.Equal(t, 2, attemptErr.AttemptsLeft)
	otpRepo.AssertNotCalled(t, "Consume", mock.Anything, mock.Anything)
}

// Третья неверная попытка сжигает код целиком: следующий ввод, даже верный,
// уже не сработает — нужен новый код.
func TestVerifyExhaustedAttemptsBurnsCode(t *testing.T) {
	uc, userRepo, otpRepo, _, _ := newOTPUseCase(t)
	user := verifiedUser()
	code := activeCode(t, user, domain.OTPPurposeLogin, "1234")
	userRepo.On("GetByEmail", user.Email).Return(user, nil)
	otpRepo.On("GetActive", user.ID, domain.OTPPurposeLogin).Return(code, nil)
	otpRepo.On("IncrementAttempts", code.ID, 3).Return(3, nil)
	otpRepo.On("InvalidateActive", user.ID, domain.OTPPurposeLogin).Return(nil)

	_, _, _, err := uc.VerifyCode(user.Email, "9999", domain.OTPPurposeLogin)

	assert.ErrorIs(t, err, domain.ErrOTPAttemptsExceeded)
	otpRepo.AssertCalled(t, "InvalidateActive", user.ID, domain.OTPPurposeLogin)
}

func TestVerifyExpiredCode(t *testing.T) {
	uc, userRepo, otpRepo, _, _ := newOTPUseCase(t)
	user := verifiedUser()
	code := activeCode(t, user, domain.OTPPurposeLogin, "1234")
	code.ExpiresAt = time.Now().Add(-time.Second)
	userRepo.On("GetByEmail", user.Email).Return(user, nil)
	otpRepo.On("GetActive", user.ID, domain.OTPPurposeLogin).Return(code, nil)

	_, _, _, err := uc.VerifyCode(user.Email, "1234", domain.OTPPurposeLogin)

	assert.ErrorIs(t, err, domain.ErrOTPInvalid)
	otpRepo.AssertNotCalled(t, "IncrementAttempts", mock.Anything, mock.Anything)
}

func TestVerifyNoActiveCode(t *testing.T) {
	uc, userRepo, otpRepo, _, _ := newOTPUseCase(t)
	user := verifiedUser()
	userRepo.On("GetByEmail", user.Email).Return(user, nil)
	otpRepo.On("GetActive", user.ID, domain.OTPPurposeLogin).Return(nil, domain.ErrOTPNotFound)

	_, _, _, err := uc.VerifyCode(user.Email, "1234", domain.OTPPurposeLogin)

	assert.ErrorIs(t, err, domain.ErrOTPInvalid)
}

func TestVerifyUnknownEmailLooksIdentical(t *testing.T) {
	uc, userRepo, _, _, _ := newOTPUseCase(t)
	userRepo.On("GetByEmail", "nobody@e.com").Return(nil, errors.New("user not found"))

	_, _, _, err := uc.VerifyCode("nobody@e.com", "1234", domain.OTPPurposeLogin)

	assert.ErrorIs(t, err, domain.ErrOTPInvalid)
}

// Гонка: код уже погашен параллельным запросом. Repository.Consume отвечает
// ErrOTPNotFound, и вторая сессия не выдаётся.
func TestVerifyLosesRaceOnConsume(t *testing.T) {
	uc, userRepo, otpRepo, _, _ := newOTPUseCase(t)
	user := verifiedUser()
	code := activeCode(t, user, domain.OTPPurposeLogin, "1234")
	userRepo.On("GetByEmail", user.Email).Return(user, nil)
	otpRepo.On("GetActive", user.ID, domain.OTPPurposeLogin).Return(code, nil)
	otpRepo.On("IncrementAttempts", code.ID, 3).Return(1, nil)
	otpRepo.On("Consume", code.ID, mock.Anything).Return(domain.ErrOTPNotFound)

	_, access, _, err := uc.VerifyCode(user.Email, "1234", domain.OTPPurposeLogin)

	assert.ErrorIs(t, err, domain.ErrOTPInvalid)
	assert.Empty(t, access)
}

// Регрессия на обход лимита попыток параллельными запросами. Проверка
// остатка и расход слота — один атомарный UPDATE, и он идёт ДО сравнения
// кода. Когда слотов не осталось, репозиторий не задевает строку и отвечает
// ErrOTPNotFound — и тогда даже ЗАВЕДОМО ВЕРНЫЙ код не открывает сессию.
// Прежний порядок (сравнить, потом посчитать) этот тест провалил бы:
// hmac.Equal сошёлся бы раньше, чем кто-либо посмотрел на счётчик.
func TestVerifyCorrectCodeRejectedWhenAttemptBudgetSpent(t *testing.T) {
	uc, userRepo, otpRepo, _, refreshRepo := newOTPUseCase(t)
	user := verifiedUser()
	code := activeCode(t, user, domain.OTPPurposeLogin, "1234")
	userRepo.On("GetByEmail", user.Email).Return(user, nil)
	otpRepo.On("GetActive", user.ID, domain.OTPPurposeLogin).Return(code, nil)
	otpRepo.On("IncrementAttempts", code.ID, 3).Return(0, domain.ErrOTPNotFound)
	otpRepo.On("InvalidateActive", user.ID, domain.OTPPurposeLogin).Return(nil)
	// Consume и выдача токенов замоканы намеренно: при неверном порядке
	// (сравнение раньше расхода попытки) юзкейс дошёл бы до них и выдал
	// сессию — тест обязан упасть на утверждениях, а не на панике мока.
	otpRepo.On("Consume", code.ID, mock.Anything).Return(nil)
	refreshRepo.On("Create", mock.Anything).Return(nil)

	got, access, refresh, err := uc.VerifyCode(user.Email, "1234", domain.OTPPurposeLogin)

	assert.ErrorIs(t, err, domain.ErrOTPAttemptsExceeded)
	assert.Nil(t, got)
	assert.Empty(t, access)
	assert.Empty(t, refresh)
	otpRepo.AssertNotCalled(t, "Consume", mock.Anything, mock.Anything)
	// Код дожигается и здесь: предыдущий запрос мог исчерпать лимит, но
	// упасть на InvalidateActive и оставить строку живой.
	otpRepo.AssertCalled(t, "InvalidateActive", user.ID, domain.OTPPurposeLogin)
}

// Слот тратится на каждой проверке, включая успешную: это и есть
// доказательство порядка «сначала посчитать, потом сравнивать». Лимит
// передаётся в репозиторий, чтобы условие attempts < max стояло в WHERE.
func TestVerifySpendsAttemptBeforeComparing(t *testing.T) {
	uc, userRepo, otpRepo, _, refreshRepo := newOTPUseCase(t)
	user := verifiedUser()
	code := activeCode(t, user, domain.OTPPurposeLogin, "1234")
	userRepo.On("GetByEmail", user.Email).Return(user, nil)
	otpRepo.On("GetActive", user.ID, domain.OTPPurposeLogin).Return(code, nil)
	otpRepo.On("IncrementAttempts", code.ID, 3).Return(1, nil)
	otpRepo.On("Consume", code.ID, mock.Anything).Return(nil)
	refreshRepo.On("Create", mock.Anything).Return(nil)

	_, access, _, err := uc.VerifyCode(user.Email, "1234", domain.OTPPurposeLogin)

	require.NoError(t, err)
	assert.NotEmpty(t, access)
	otpRepo.AssertCalled(t, "IncrementAttempts", code.ID, testPolicy().MaxAttempts)
}
