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

// activeCode собирает живой код с корректным HMAC для заданного email+code,
// как otpUseCase записал бы его при Create.
func activeCode(t *testing.T, email string, p domain.OTPPurpose, code string) *domain.OTPCode {
	t.Helper()
	return &domain.OTPCode{
		ID:        uuid.New(),
		Email:     email,
		Purpose:   p,
		CodeHash:  usecase.HashOTPCodeForTest(testPolicy().Secret, email, p, code),
		CreatedAt: time.Now().Add(-time.Minute),
		ExpiresAt: time.Now().Add(4 * time.Minute),
	}
}

// --- RequestCode ---

func TestRequestCodeForKnownVerifiedEmailFillsUserID(t *testing.T) {
	uc, userRepo, otpRepo, mailer, _ := newOTPUseCase(t)
	user := verifiedUser()
	var stored *domain.OTPCode
	userRepo.On("GetByEmail", user.Email).Return(user, nil)
	otpRepo.On("LastIssuedAt", user.Email).Return(nil, nil)
	otpRepo.On("CountIssuedSince", user.Email, mock.Anything).Return(0, nil)
	otpRepo.On("InvalidateActive", user.Email).Return(nil)
	otpRepo.On("Create", mock.Anything).Run(func(args mock.Arguments) {
		stored = args.Get(0).(*domain.OTPCode)
	}).Return(nil)
	mailer.On("Send", mock.Anything).Return(nil)

	err := uc.RequestCode(user.Email)

	require.NoError(t, err)
	require.NotNil(t, stored)
	require.NotNil(t, stored.UserID, "email уже принадлежит пользователю — user_id заполняется")
	assert.Equal(t, user.ID, *stored.UserID)
	assert.Equal(t, domain.OTPPurposeLogin, stored.Purpose)
	require.Len(t, mailer.Sent, 1)
	assert.Equal(t, user.Email, mailer.Sent[0].To)
}

// Identifier-first: неизвестный email больше не тихий no-op — код всё
// равно выпускается и отправляется, просто без user_id.
func TestRequestCodeForUnknownEmailStillSendsWithoutUserID(t *testing.T) {
	uc, userRepo, otpRepo, mailer, _ := newOTPUseCase(t)
	var stored *domain.OTPCode
	userRepo.On("GetByEmail", "nobody@e.com").Return(nil, errors.New("user not found"))
	otpRepo.On("LastIssuedAt", "nobody@e.com").Return(nil, nil)
	otpRepo.On("CountIssuedSince", "nobody@e.com", mock.Anything).Return(0, nil)
	otpRepo.On("InvalidateActive", "nobody@e.com").Return(nil)
	otpRepo.On("Create", mock.Anything).Run(func(args mock.Arguments) {
		stored = args.Get(0).(*domain.OTPCode)
	}).Return(nil)
	mailer.On("Send", mock.Anything).Return(nil)

	err := uc.RequestCode("nobody@e.com")

	require.NoError(t, err)
	require.NotNil(t, stored)
	assert.Nil(t, stored.UserID)
	assert.Equal(t, domain.OTPPurposeRegistration, stored.Purpose)
	require.Len(t, mailer.Sent, 1)
}

// Существующий, но ещё не подтверждённый email (легаси-регистрация до этого
// релиза) — тоже отправляется без user_id: с точки зрения identifier-first
// код регистрационного вида, даже если пользователь физически уже есть.
func TestRequestCodeForUnverifiedEmailIsRegistrationShaped(t *testing.T) {
	uc, userRepo, otpRepo, mailer, _ := newOTPUseCase(t)
	user := unverifiedUser()
	var stored *domain.OTPCode
	userRepo.On("GetByEmail", user.Email).Return(user, nil)
	otpRepo.On("LastIssuedAt", user.Email).Return(nil, nil)
	otpRepo.On("CountIssuedSince", user.Email, mock.Anything).Return(0, nil)
	otpRepo.On("InvalidateActive", user.Email).Return(nil)
	otpRepo.On("Create", mock.Anything).Run(func(args mock.Arguments) {
		stored = args.Get(0).(*domain.OTPCode)
	}).Return(nil)
	mailer.On("Send", mock.Anything).Return(nil)

	require.NoError(t, uc.RequestCode(user.Email))

	assert.Nil(t, stored.UserID)
	assert.Equal(t, domain.OTPPurposeRegistration, stored.Purpose)
}

func TestRequestCodeStoresHashNotCode(t *testing.T) {
	uc, userRepo, otpRepo, mailer, _ := newOTPUseCase(t)
	user := verifiedUser()
	var stored *domain.OTPCode
	userRepo.On("GetByEmail", user.Email).Return(user, nil)
	otpRepo.On("LastIssuedAt", user.Email).Return(nil, nil)
	otpRepo.On("CountIssuedSince", user.Email, mock.Anything).Return(0, nil)
	otpRepo.On("InvalidateActive", user.Email).Return(nil)
	otpRepo.On("Create", mock.Anything).Run(func(args mock.Arguments) {
		stored = args.Get(0).(*domain.OTPCode)
	}).Return(nil)
	mailer.On("Send", mock.Anything).Return(nil)

	require.NoError(t, uc.RequestCode(user.Email))

	require.NotNil(t, stored)
	assert.Len(t, stored.CodeHash, 32, "HMAC-SHA256 это ровно 32 байта")
	assert.NotContains(t, string(stored.CodeHash), mailer.Sent[0].Text)
	assert.Equal(t, 0, stored.Attempts)
	assert.True(t, stored.ExpiresAt.After(time.Now()))
}

func TestRequestCodeCooldown(t *testing.T) {
	uc, userRepo, otpRepo, mailer, _ := newOTPUseCase(t)
	user := verifiedUser()
	justNow := time.Now().Add(-10 * time.Second)
	userRepo.On("GetByEmail", user.Email).Return(user, nil)
	otpRepo.On("LastIssuedAt", user.Email).Return(&justNow, nil)

	err := uc.RequestCode(user.Email)

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
	otpRepo.On("LastIssuedAt", user.Email).Return(&long, nil)
	otpRepo.On("CountIssuedSince", user.Email, mock.Anything).Return(5, nil)

	err := uc.RequestCode(user.Email)

	var throttled *domain.OTPThrottledError
	require.True(t, errors.As(err, &throttled))
	assert.True(t, throttled.Hourly)
	assert.Empty(t, mailer.Sent)
}

func TestRequestCodeInvalidatesPrevious(t *testing.T) {
	uc, userRepo, otpRepo, mailer, _ := newOTPUseCase(t)
	user := verifiedUser()
	long := time.Now().Add(-10 * time.Minute)
	userRepo.On("GetByEmail", user.Email).Return(user, nil)
	otpRepo.On("LastIssuedAt", user.Email).Return(&long, nil)
	otpRepo.On("CountIssuedSince", user.Email, mock.Anything).Return(1, nil)
	otpRepo.On("InvalidateActive", user.Email).Return(nil)
	otpRepo.On("Create", mock.Anything).Return(nil)
	mailer.On("Send", mock.Anything).Return(nil)

	require.NoError(t, uc.RequestCode(user.Email))

	otpRepo.AssertCalled(t, "InvalidateActive", user.Email)
}

func TestRequestCodeMailFailureKeepsCode(t *testing.T) {
	uc, userRepo, otpRepo, mailer, _ := newOTPUseCase(t)
	user := verifiedUser()
	userRepo.On("GetByEmail", user.Email).Return(user, nil)
	otpRepo.On("LastIssuedAt", user.Email).Return(nil, nil)
	otpRepo.On("CountIssuedSince", user.Email, mock.Anything).Return(0, nil)
	otpRepo.On("InvalidateActive", user.Email).Return(nil)
	otpRepo.On("Create", mock.Anything).Return(nil)
	mailer.On("Send", mock.Anything).Return(errors.New("smtp down"))

	err := uc.RequestCode(user.Email)

	assert.ErrorIs(t, err, domain.ErrMailSendFailed)
	otpRepo.AssertCalled(t, "Create", mock.Anything)
}

// --- VerifyCode: существующий пользователь ---

func TestVerifyExistingVerifiedLogsInWithoutTouchingVerifiedAt(t *testing.T) {
	uc, userRepo, otpRepo, _, refreshRepo := newOTPUseCase(t)
	user := verifiedUser()
	code := activeCode(t, user.Email, domain.OTPPurposeLogin, "1234")
	otpRepo.On("GetActive", user.Email).Return(code, nil)
	otpRepo.On("IncrementAttempts", code.ID, 3).Return(1, nil)
	userRepo.On("GetByEmail", user.Email).Return(user, nil)
	otpRepo.On("Consume", code.ID, mock.Anything).Return(nil)
	refreshRepo.On("Create", mock.Anything).Return(nil)

	got, access, refresh, err := uc.VerifyCode(user.Email, "1234", "")

	require.NoError(t, err)
	assert.NotEmpty(t, access)
	assert.NotEmpty(t, refresh)
	assert.Equal(t, user.ID, got.ID)
	assert.Empty(t, got.Password)
	userRepo.AssertNotCalled(t, "MarkEmailVerified", mock.Anything, mock.Anything)
}

// Легаси-неподтверждённый (username уже есть от старого /register) —
// подтверждается и логинится без запроса username.
func TestVerifyLegacyUnverifiedLogsInAndMarksVerified(t *testing.T) {
	uc, userRepo, otpRepo, _, refreshRepo := newOTPUseCase(t)
	user := unverifiedUser()
	code := activeCode(t, user.Email, domain.OTPPurposeRegistration, "0429")
	otpRepo.On("GetActive", user.Email).Return(code, nil)
	otpRepo.On("IncrementAttempts", code.ID, 3).Return(1, nil)
	userRepo.On("GetByEmail", user.Email).Return(user, nil)
	otpRepo.On("Consume", code.ID, mock.Anything).Return(nil)
	userRepo.On("MarkEmailVerified", user.ID, mock.Anything).Return(nil)
	refreshRepo.On("Create", mock.Anything).Return(nil)

	got, access, _, err := uc.VerifyCode(user.Email, "0429", "")

	require.NoError(t, err)
	assert.NotEmpty(t, access)
	assert.Equal(t, user.Username, got.Username, "username легаси-аккаунта не переспрашивается")
	userRepo.AssertCalled(t, "MarkEmailVerified", user.ID, mock.Anything)
}

// Ignored username для существующего пользователя — не мешает логину.
func TestVerifyExistingUserIgnoresSuppliedUsername(t *testing.T) {
	uc, userRepo, otpRepo, _, refreshRepo := newOTPUseCase(t)
	user := verifiedUser()
	code := activeCode(t, user.Email, domain.OTPPurposeLogin, "1234")
	otpRepo.On("GetActive", user.Email).Return(code, nil)
	otpRepo.On("IncrementAttempts", code.ID, 3).Return(1, nil)
	userRepo.On("GetByEmail", user.Email).Return(user, nil)
	otpRepo.On("Consume", code.ID, mock.Anything).Return(nil)
	refreshRepo.On("Create", mock.Anything).Return(nil)

	got, _, _, err := uc.VerifyCode(user.Email, "1234", "someone-elses-name")

	require.NoError(t, err)
	assert.Equal(t, user.Username, got.Username)
	userRepo.AssertNotCalled(t, "GetByUsername", mock.Anything)
}

// --- VerifyCode: новый email ---

func TestVerifyNewEmailWithoutUsernameReturnsUsernameRequiredCodeNotConsumed(t *testing.T) {
	uc, userRepo, otpRepo, _, _ := newOTPUseCase(t)
	email := "new@e.com"
	code := activeCode(t, email, domain.OTPPurposeRegistration, "0429")
	otpRepo.On("GetActive", email).Return(code, nil)
	otpRepo.On("IncrementAttempts", code.ID, 3).Return(1, nil)
	userRepo.On("GetByEmail", email).Return(nil, errors.New("user not found"))

	got, access, refresh, err := uc.VerifyCode(email, "0429", "")

	assert.ErrorIs(t, err, domain.ErrUsernameRequired)
	assert.Nil(t, got)
	assert.Empty(t, access)
	assert.Empty(t, refresh)
	otpRepo.AssertNotCalled(t, "Consume", mock.Anything, mock.Anything)
}

func TestVerifyNewEmailWithTakenUsernameCodeNotConsumed(t *testing.T) {
	uc, userRepo, otpRepo, _, _ := newOTPUseCase(t)
	email := "new@e.com"
	code := activeCode(t, email, domain.OTPPurposeRegistration, "0429")
	otpRepo.On("GetActive", email).Return(code, nil)
	otpRepo.On("IncrementAttempts", code.ID, 3).Return(1, nil)
	userRepo.On("GetByEmail", email).Return(nil, errors.New("user not found"))
	userRepo.On("GetByUsername", "taken").Return(&domain.User{ID: uuid.New(), Username: "taken"}, nil)

	_, _, _, err := uc.VerifyCode(email, "0429", "taken")

	assert.ErrorIs(t, err, domain.ErrUsernameTaken)
	otpRepo.AssertNotCalled(t, "Consume", mock.Anything, mock.Anything)
	userRepo.AssertNotCalled(t, "Create", mock.Anything)
}

func TestVerifyNewEmailWithFreeUsernameCreatesVerifiedUserAndLogsIn(t *testing.T) {
	uc, userRepo, otpRepo, _, refreshRepo := newOTPUseCase(t)
	email := "new@e.com"
	code := activeCode(t, email, domain.OTPPurposeRegistration, "0429")
	var created *domain.User
	var createdPasswordHash string
	otpRepo.On("GetActive", email).Return(code, nil)
	otpRepo.On("IncrementAttempts", code.ID, 3).Return(1, nil)
	userRepo.On("GetByEmail", email).Return(nil, errors.New("user not found"))
	userRepo.On("GetByUsername", "newbie").Return(nil, errors.New("user not found"))
	otpRepo.On("Consume", code.ID, mock.Anything).Return(nil)
	userRepo.On("Create", mock.Anything).Run(func(args mock.Arguments) {
		created = args.Get(0).(*domain.User)
		createdPasswordHash = created.Password
	}).Return(nil)
	refreshRepo.On("Create", mock.Anything).Return(nil)

	got, access, refresh, err := uc.VerifyCode(email, "0429", "newbie")

	require.NoError(t, err)
	assert.NotEmpty(t, access)
	assert.NotEmpty(t, refresh)
	require.NotNil(t, created)
	assert.Equal(t, "newbie", created.Username)
	assert.Equal(t, email, created.Email)
	assert.NotNil(t, created.EmailVerifiedAt, "новый identifier-first аккаунт создаётся сразу подтверждённым")
	assert.NotEmpty(t, createdPasswordHash, "случайный bcrypt-хеш всё равно должен быть записан — колонка NOT NULL")
	assert.Equal(t, got.ID, created.ID)
	assert.Empty(t, got.Password)
}

// Гонка на одном и том же новом email: Consume — точка сериализации, тот же
// механизм, что уже защищает существующих пользователей. Второй запрос
// проигрывает Consume и не должен создавать вторую строку в users.
func TestVerifyNewEmailConcurrentRaceOnlyOneCreates(t *testing.T) {
	uc, userRepo, otpRepo, _, _ := newOTPUseCase(t)
	email := "race@e.com"
	code := activeCode(t, email, domain.OTPPurposeRegistration, "0429")
	otpRepo.On("GetActive", email).Return(code, nil)
	otpRepo.On("IncrementAttempts", code.ID, 3).Return(2, nil)
	userRepo.On("GetByEmail", email).Return(nil, errors.New("user not found"))
	userRepo.On("GetByUsername", "loser").Return(nil, errors.New("user not found"))
	otpRepo.On("Consume", code.ID, mock.Anything).Return(domain.ErrOTPNotFound)

	got, access, _, err := uc.VerifyCode(email, "0429", "loser")

	assert.ErrorIs(t, err, domain.ErrOTPInvalid)
	assert.Nil(t, got)
	assert.Empty(t, access)
	userRepo.AssertNotCalled(t, "Create", mock.Anything)
}

// Гонка на username между ДВУМЯ РАЗНЫМИ новыми email: оба проходят
// GetByUsername до Create (race window), Consume у каждого свой (разные
// OTP-записи) — оба успевают дойти до Create. Репозиторий у проигравшего
// ловит нарушение уникальности username и должен вернуть
// domain.ErrUsernameTaken; usecase обязан пробросить этот сентинел как
// есть, не оборачивая его в fmt.Errorf, иначе errors.Is в handler'е не
// сработает и ответ станет 500 вместо чистого 409.
func TestVerifyNewEmailUsernameRaceReturnsUsernameTakenUnwrapped(t *testing.T) {
	uc, userRepo, otpRepo, _, _ := newOTPUseCase(t)
	email := "second@e.com"
	code := activeCode(t, email, domain.OTPPurposeRegistration, "0429")
	otpRepo.On("GetActive", email).Return(code, nil)
	otpRepo.On("IncrementAttempts", code.ID, 3).Return(1, nil)
	userRepo.On("GetByEmail", email).Return(nil, errors.New("user not found"))
	userRepo.On("GetByUsername", "shared").Return(nil, errors.New("user not found"))
	otpRepo.On("Consume", code.ID, mock.Anything).Return(nil)
	// Симулируем проигрыш гонки в Postgres: репозиторий уже перевёл 23505 на
	// users_username_key в domain.ErrUsernameTaken (см. userRepository.Create).
	userRepo.On("Create", mock.Anything).Return(domain.ErrUsernameTaken)

	got, access, refresh, err := uc.VerifyCode(email, "0429", "shared")

	assert.ErrorIs(t, err, domain.ErrUsernameTaken)
	assert.Nil(t, got)
	assert.Empty(t, access)
	assert.Empty(t, refresh)
}

// --- Нормализация email: identifier-first обязан видеть Foo@bar.com и
// foo@bar.com как один и тот же адрес на каждом шаге, иначе регистр в
// email заводит дубликат аккаунта. Мок реагирует только на ожидания,
// заданные ТОЧНО в нижнем регистре — если бы normalize не случился (или
// случился не в начале функции), вызовы ушли бы с сырым Test@Example.com,
// не совпали бы ни с одним .On(...) и testify запаниковал бы на
// неожиданном вызове, провалив тест. ---

func TestRequestCodeNormalizesEmailCase(t *testing.T) {
	uc, userRepo, otpRepo, mailer, _ := newOTPUseCase(t)
	const normalized = "test@example.com"
	var stored *domain.OTPCode
	userRepo.On("GetByEmail", normalized).Return(nil, errors.New("user not found"))
	otpRepo.On("LastIssuedAt", normalized).Return(nil, nil)
	otpRepo.On("CountIssuedSince", normalized, mock.Anything).Return(0, nil)
	otpRepo.On("InvalidateActive", normalized).Return(nil)
	otpRepo.On("Create", mock.Anything).Run(func(args mock.Arguments) {
		stored = args.Get(0).(*domain.OTPCode)
	}).Return(nil)
	mailer.On("Send", mock.Anything).Return(nil)

	err := uc.RequestCode("  Test@Example.com  ")

	require.NoError(t, err)
	require.NotNil(t, stored)
	assert.Equal(t, normalized, stored.Email)
	require.Len(t, mailer.Sent, 1)
	assert.Equal(t, normalized, mailer.Sent[0].To)
}

func TestVerifyCodeNormalizesEmailCase(t *testing.T) {
	uc, userRepo, otpRepo, _, refreshRepo := newOTPUseCase(t)
	const normalized = "test@example.com"
	user := &domain.User{ID: uuid.New(), Username: "u", Email: normalized}
	at := time.Now().Add(-time.Hour)
	user.EmailVerifiedAt = &at
	code := activeCode(t, normalized, domain.OTPPurposeLogin, "1234")
	otpRepo.On("GetActive", normalized).Return(code, nil)
	otpRepo.On("IncrementAttempts", code.ID, 3).Return(1, nil)
	userRepo.On("GetByEmail", normalized).Return(user, nil)
	otpRepo.On("Consume", code.ID, mock.Anything).Return(nil)
	refreshRepo.On("Create", mock.Anything).Return(nil)

	got, access, refresh, err := uc.VerifyCode("Test@Example.com", "1234", "")

	require.NoError(t, err)
	assert.NotEmpty(t, access)
	assert.NotEmpty(t, refresh)
	assert.Equal(t, user.ID, got.ID)
}

// --- VerifyCode: код неверный/истёкший/попытки исчерпаны — без изменений в поведении ---

func TestVerifyWrongCodeIncrementsAttempts(t *testing.T) {
	uc, _, otpRepo, _, _ := newOTPUseCase(t)
	email := "u@e.com"
	code := activeCode(t, email, domain.OTPPurposeLogin, "1234")
	otpRepo.On("GetActive", email).Return(code, nil)
	otpRepo.On("IncrementAttempts", code.ID, 3).Return(1, nil)

	_, _, _, err := uc.VerifyCode(email, "9999", "")

	assert.ErrorIs(t, err, domain.ErrOTPInvalid)
	var attemptErr *domain.OTPAttemptError
	require.True(t, errors.As(err, &attemptErr))
	assert.Equal(t, 2, attemptErr.AttemptsLeft)
	otpRepo.AssertNotCalled(t, "Consume", mock.Anything, mock.Anything)
}

func TestVerifyExhaustedAttemptsBurnsCode(t *testing.T) {
	uc, _, otpRepo, _, _ := newOTPUseCase(t)
	email := "u@e.com"
	code := activeCode(t, email, domain.OTPPurposeLogin, "1234")
	otpRepo.On("GetActive", email).Return(code, nil)
	otpRepo.On("IncrementAttempts", code.ID, 3).Return(3, nil)
	otpRepo.On("InvalidateActive", email).Return(nil)

	_, _, _, err := uc.VerifyCode(email, "9999", "")

	assert.ErrorIs(t, err, domain.ErrOTPAttemptsExceeded)
	otpRepo.AssertCalled(t, "InvalidateActive", email)
}

func TestVerifyExpiredCode(t *testing.T) {
	uc, _, otpRepo, _, _ := newOTPUseCase(t)
	email := "u@e.com"
	code := activeCode(t, email, domain.OTPPurposeLogin, "1234")
	code.ExpiresAt = time.Now().Add(-time.Second)
	otpRepo.On("GetActive", email).Return(code, nil)

	_, _, _, err := uc.VerifyCode(email, "1234", "")

	assert.ErrorIs(t, err, domain.ErrOTPInvalid)
	otpRepo.AssertNotCalled(t, "IncrementAttempts", mock.Anything, mock.Anything)
}

func TestVerifyNoActiveCode(t *testing.T) {
	uc, _, otpRepo, _, _ := newOTPUseCase(t)
	otpRepo.On("GetActive", "u@e.com").Return(nil, domain.ErrOTPNotFound)

	_, _, _, err := uc.VerifyCode("u@e.com", "1234", "")

	assert.ErrorIs(t, err, domain.ErrOTPInvalid)
}

func TestVerifyLosesRaceOnConsumeForExistingUser(t *testing.T) {
	uc, userRepo, otpRepo, _, _ := newOTPUseCase(t)
	user := verifiedUser()
	code := activeCode(t, user.Email, domain.OTPPurposeLogin, "1234")
	otpRepo.On("GetActive", user.Email).Return(code, nil)
	otpRepo.On("IncrementAttempts", code.ID, 3).Return(1, nil)
	userRepo.On("GetByEmail", user.Email).Return(user, nil)
	otpRepo.On("Consume", code.ID, mock.Anything).Return(domain.ErrOTPNotFound)

	_, access, _, err := uc.VerifyCode(user.Email, "1234", "")

	assert.ErrorIs(t, err, domain.ErrOTPInvalid)
	assert.Empty(t, access)
}

// Регрессия на обход лимита попыток параллельными запросами (VYC-85) — не
// затронута переходом на email-ключ, но должна остаться зелёной.
func TestVerifyCorrectCodeRejectedWhenAttemptBudgetSpent(t *testing.T) {
	uc, _, otpRepo, _, _ := newOTPUseCase(t)
	email := "u@e.com"
	code := activeCode(t, email, domain.OTPPurposeLogin, "1234")
	otpRepo.On("GetActive", email).Return(code, nil)
	otpRepo.On("IncrementAttempts", code.ID, 3).Return(0, domain.ErrOTPNotFound)
	otpRepo.On("InvalidateActive", email).Return(nil)

	got, access, refresh, err := uc.VerifyCode(email, "1234", "")

	assert.ErrorIs(t, err, domain.ErrOTPAttemptsExceeded)
	assert.Nil(t, got)
	assert.Empty(t, access)
	assert.Empty(t, refresh)
	otpRepo.AssertNotCalled(t, "Consume", mock.Anything, mock.Anything)
	otpRepo.AssertCalled(t, "InvalidateActive", email)
}
