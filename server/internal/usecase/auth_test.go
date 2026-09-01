package usecase_test

import (
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"

	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/internal/usecase"
)

type MockUserRepository struct {
	mock.Mock
}

func (m *MockUserRepository) Create(user *domain.User) error {
	args := m.Called(user)
	return args.Error(0)
}

func (m *MockUserRepository) GetByID(id uuid.UUID) (*domain.User, error) {
	args := m.Called(id)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*domain.User), args.Error(1)
}

func (m *MockUserRepository) GetByEmail(email string) (*domain.User, error) {
	args := m.Called(email)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*domain.User), args.Error(1)
}

func (m *MockUserRepository) GetByUsername(username string) (*domain.User, error) {
	args := m.Called(username)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*domain.User), args.Error(1)
}

func (m *MockUserRepository) Update(id uuid.UUID, updates map[string]interface{}) error {
	args := m.Called(id, updates)
	return args.Error(0)
}

func (m *MockUserRepository) Search(query string, limit, offset int) ([]*domain.User, error) {
	args := m.Called(query, limit, offset)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).([]*domain.User), args.Error(1)
}

func (m *MockUserRepository) UpdateLastVisited(id uuid.UUID, serverID, channelID *uuid.UUID) error {
	args := m.Called(id, serverID, channelID)
	return args.Error(0)
}

func (m *MockUserRepository) MarkEmailVerified(id uuid.UUID, at time.Time) error {
	return m.Called(id, at).Error(0)
}

func (m *MockUserRepository) DeleteUnverifiedBefore(t time.Time) (int64, error) {
	args := m.Called(t)
	return args.Get(0).(int64), args.Error(1)
}

type MockRefreshTokenRepository struct {
	mock.Mock
}

func (m *MockRefreshTokenRepository) Create(t *domain.RefreshToken) error {
	args := m.Called(t)
	return args.Error(0)
}

func (m *MockRefreshTokenRepository) GetByHash(hash []byte) (*domain.RefreshToken, error) {
	args := m.Called(hash)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*domain.RefreshToken), args.Error(1)
}

func (m *MockRefreshTokenRepository) GetByID(id uuid.UUID) (*domain.RefreshToken, error) {
	args := m.Called(id)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*domain.RefreshToken), args.Error(1)
}

func (m *MockRefreshTokenRepository) MarkRotated(id, replacedBy uuid.UUID, revokedAt time.Time) error {
	args := m.Called(id, replacedBy, revokedAt)
	return args.Error(0)
}

func (m *MockRefreshTokenRepository) RevokeFamily(familyID uuid.UUID) error {
	args := m.Called(familyID)
	return args.Error(0)
}

type MockOTPSender struct{ mock.Mock }

func (m *MockOTPSender) RequestCode(email string, p domain.OTPPurpose) error {
	return m.Called(email, p).Error(0)
}

func newAuthUseCase(userRepo *MockUserRepository, refreshRepo *MockRefreshTokenRepository) domain.AuthUseCase {
	return usecase.NewAuthUseCase(userRepo, refreshRepo, new(MockOTPSender), "test-secret", 24*time.Hour, 30*24*time.Hour)
}

func TestRegisterCreatesUnverifiedAndSendsCode(t *testing.T) {
	userRepo := new(MockUserRepository)
	refreshRepo := new(MockRefreshTokenRepository)
	sender := new(MockOTPSender)
	userRepo.On("GetByEmail", "new@e.com").Return(nil, errors.New("not found"))
	userRepo.On("GetByUsername", "newbie").Return(nil, errors.New("not found"))
	userRepo.On("Create", mock.Anything).Return(nil)
	sender.On("RequestCode", "new@e.com", domain.OTPPurposeRegistration).Return(nil)

	uc := usecase.NewAuthUseCase(userRepo, refreshRepo, sender, "s", time.Minute, time.Hour)
	user, err := uc.Register("newbie", "new@e.com", "password123")

	require.NoError(t, err)
	assert.Nil(t, user.EmailVerifiedAt, "новый пользователь неподтверждён")
	sender.AssertCalled(t, "RequestCode", "new@e.com", domain.OTPPurposeRegistration)
	refreshRepo.AssertNotCalled(t, "Create", mock.Anything)
}

// Повторная регистрация на брошенный неподтверждённый адрес перезаписывает
// её и шлёт новый код. Без этой ветки человек, потерявший письмо, застревал
// бы навсегда: 409 при повторной регистрации и 403 при входе.
func TestRegisterOverwritesUnverifiedAccount(t *testing.T) {
	userRepo := new(MockUserRepository)
	refreshRepo := new(MockRefreshTokenRepository)
	sender := new(MockOTPSender)
	existing := &domain.User{ID: uuid.New(), Username: "old", Email: "same@e.com"}
	userRepo.On("GetByEmail", "same@e.com").Return(existing, nil)
	// Ruling-проверка перед перезаписью: новое имя никем не занято.
	userRepo.On("GetByUsername", "newname").Return(nil, errors.New("not found"))
	userRepo.On("Update", existing.ID, mock.Anything).Return(nil)
	sender.On("RequestCode", "same@e.com", domain.OTPPurposeRegistration).Return(nil)

	uc := usecase.NewAuthUseCase(userRepo, refreshRepo, sender, "s", time.Minute, time.Hour)
	_, err := uc.Register("newname", "same@e.com", "password123")

	require.NoError(t, err)
	userRepo.AssertCalled(t, "Update", existing.ID, mock.Anything)
	userRepo.AssertNotCalled(t, "Create", mock.Anything)
}

func TestRegisterRejectsVerifiedEmail(t *testing.T) {
	userRepo := new(MockUserRepository)
	refreshRepo := new(MockRefreshTokenRepository)
	sender := new(MockOTPSender)
	at := time.Now()
	userRepo.On("GetByEmail", "taken@e.com").Return(&domain.User{ID: uuid.New(), EmailVerifiedAt: &at}, nil)

	uc := usecase.NewAuthUseCase(userRepo, refreshRepo, sender, "s", time.Minute, time.Hour)
	_, err := uc.Register("someone", "taken@e.com", "password123")

	assert.ErrorIs(t, err, domain.ErrEmailTaken)
}

// Перезапись брошенной регистрации меняет username, но не проверяет его
// уникальность выше по стеку — единственная защита от гонки с чужим именем
// стоит здесь. Без неё Update долетает до UNIQUE-констрейнта в Postgres и
// падает наружу необработанным 500 вместо честного 409 username_taken.
func TestRegisterOverwriteRejectsUsernameTakenByOther(t *testing.T) {
	userRepo := new(MockUserRepository)
	refreshRepo := new(MockRefreshTokenRepository)
	sender := new(MockOTPSender)
	existing := &domain.User{ID: uuid.New(), Username: "old", Email: "same@e.com"}
	otherUser := &domain.User{ID: uuid.New(), Username: "newname", Email: "other@e.com"}
	userRepo.On("GetByEmail", "same@e.com").Return(existing, nil)
	userRepo.On("GetByUsername", "newname").Return(otherUser, nil)

	uc := usecase.NewAuthUseCase(userRepo, refreshRepo, sender, "s", time.Minute, time.Hour)
	_, err := uc.Register("newname", "same@e.com", "password123")

	assert.ErrorIs(t, err, domain.ErrUsernameTaken)
	userRepo.AssertNotCalled(t, "Update", mock.Anything, mock.Anything)
}

func TestLoginRejectsUnverified(t *testing.T) {
	userRepo := new(MockUserRepository)
	refreshRepo := new(MockRefreshTokenRepository)
	sender := new(MockOTPSender)
	hashed, _ := bcrypt.GenerateFromPassword([]byte("password123"), bcrypt.DefaultCost)
	userRepo.On("GetByEmail", "u@e.com").Return(&domain.User{
		ID: uuid.New(), Email: "u@e.com", Password: string(hashed),
	}, nil)

	uc := usecase.NewAuthUseCase(userRepo, refreshRepo, sender, "s", time.Minute, time.Hour)
	_, _, _, err := uc.Login("u@e.com", "password123")

	assert.ErrorIs(t, err, domain.ErrEmailNotVerified)
	// Письмо на этом шаге не отправляется: иначе логин стал бы бесплатным
	// спам-вектором на любой чужой адрес.
	sender.AssertNotCalled(t, "RequestCode", mock.Anything, mock.Anything)
}

func TestRegister_UserAlreadyExistsWithEmail(t *testing.T) {
	mockRepo := new(MockUserRepository)
	refreshRepo := new(MockRefreshTokenRepository)
	authUseCase := newAuthUseCase(mockRepo, refreshRepo)

	// Подтверждённая почта — это настоящий занятый адрес, а не брошенная
	// регистрация: перезаписи здесь быть не должно.
	at := time.Now()
	mockRepo.On("GetByEmail", "test@example.com").Return(&domain.User{EmailVerifiedAt: &at}, nil)

	user, err := authUseCase.Register("testuser", "test@example.com", "password123")

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "user with this email already exists")
	assert.Nil(t, user)
	mockRepo.AssertExpectations(t)
}

func TestRegister_UserAlreadyExistsByUsername(t *testing.T) {
	mockRepo := new(MockUserRepository)
	refreshRepo := new(MockRefreshTokenRepository)
	authUseCase := newAuthUseCase(mockRepo, refreshRepo)

	mockRepo.On("GetByEmail", "test@example.com").Return((*domain.User)(nil), errors.New("user not found"))
	mockRepo.On("GetByUsername", "testuser").Return(&domain.User{}, nil)

	user, err := authUseCase.Register("testuser", "test@example.com", "password123")

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "user with this username already exists")
	assert.Nil(t, user)
	mockRepo.AssertExpectations(t)
}

func TestRegister_Success(t *testing.T) {
	mockRepo := new(MockUserRepository)
	refreshRepo := new(MockRefreshTokenRepository)
	sender := new(MockOTPSender)
	authUseCase := usecase.NewAuthUseCase(mockRepo, refreshRepo, sender, "test-secret", 24*time.Hour, 30*24*time.Hour)

	mockRepo.On("GetByEmail", "test@example.com").Return((*domain.User)(nil), errors.New("user not found"))
	mockRepo.On("GetByUsername", "testuser").Return((*domain.User)(nil), errors.New("user not found"))
	mockRepo.On("Create", mock.MatchedBy(func(u *domain.User) bool {
		return u.Username == "testuser" && u.Email == "test@example.com"
	})).Return(nil)
	sender.On("RequestCode", "test@example.com", domain.OTPPurposeRegistration).Return(nil)

	user, err := authUseCase.Register("testuser", "test@example.com", "password123")

	assert.NoError(t, err)
	assert.NotNil(t, user)
	assert.Empty(t, user.Password)
	mockRepo.AssertExpectations(t)
	sender.AssertExpectations(t)
	refreshRepo.AssertNotCalled(t, "Create", mock.Anything)
}

func TestLogin_InvalidCredentials(t *testing.T) {
	mockRepo := new(MockUserRepository)
	refreshRepo := new(MockRefreshTokenRepository)
	authUseCase := newAuthUseCase(mockRepo, refreshRepo)

	mockRepo.On("GetByEmail", "wrong@example.com").Return((*domain.User)(nil), errors.New("user not found"))

	user, accessToken, refreshToken, err := authUseCase.Login("wrong@example.com", "password123")

	assert.Error(t, err)
	assert.Nil(t, user)
	assert.Empty(t, accessToken)
	assert.Empty(t, refreshToken)
	mockRepo.AssertExpectations(t)
}

func TestRefresh_Success_RotatesToken(t *testing.T) {
	mockRepo := new(MockUserRepository)
	refreshRepo := new(MockRefreshTokenRepository)
	authUseCase := newAuthUseCase(mockRepo, refreshRepo)

	userID := uuid.New()
	familyID := uuid.New()
	storedID := uuid.New()
	stored := &domain.RefreshToken{
		ID:        storedID,
		UserID:    userID,
		FamilyID:  familyID,
		ExpiresAt: time.Now().Add(time.Hour),
	}

	refreshRepo.On("GetByHash", mock.AnythingOfType("[]uint8")).Return(stored, nil)
	mockRepo.On("GetByID", userID).Return(&domain.User{ID: userID, Username: "testuser"}, nil)
	refreshRepo.On("Create", mock.AnythingOfType("*domain.RefreshToken")).Return(nil)
	refreshRepo.On("MarkRotated", storedID, mock.AnythingOfType("uuid.UUID"), mock.AnythingOfType("time.Time")).Return(nil)

	user, accessToken, newRefreshToken, err := authUseCase.Refresh("some-refresh-token")

	assert.NoError(t, err)
	assert.NotNil(t, user)
	assert.NotEmpty(t, accessToken)
	assert.NotEmpty(t, newRefreshToken)
	refreshRepo.AssertExpectations(t)
}

func TestRefresh_UnknownToken_ReturnsInvalid(t *testing.T) {
	mockRepo := new(MockUserRepository)
	refreshRepo := new(MockRefreshTokenRepository)
	authUseCase := newAuthUseCase(mockRepo, refreshRepo)

	refreshRepo.On("GetByHash", mock.AnythingOfType("[]uint8")).Return(nil, domain.ErrRefreshTokenNotFound)

	_, accessToken, newRefreshToken, err := authUseCase.Refresh("unknown-token")

	assert.ErrorIs(t, err, domain.ErrRefreshTokenInvalid)
	assert.Empty(t, accessToken)
	assert.Empty(t, newRefreshToken)
}

func TestRefresh_ExpiredToken_ReturnsInvalid(t *testing.T) {
	mockRepo := new(MockUserRepository)
	refreshRepo := new(MockRefreshTokenRepository)
	authUseCase := newAuthUseCase(mockRepo, refreshRepo)

	stored := &domain.RefreshToken{
		ID:        uuid.New(),
		UserID:    uuid.New(),
		FamilyID:  uuid.New(),
		ExpiresAt: time.Now().Add(-time.Hour),
	}
	refreshRepo.On("GetByHash", mock.AnythingOfType("[]uint8")).Return(stored, nil)

	_, accessToken, newRefreshToken, err := authUseCase.Refresh("expired-token")

	assert.ErrorIs(t, err, domain.ErrRefreshTokenInvalid)
	assert.Empty(t, accessToken)
	assert.Empty(t, newRefreshToken)
}

func TestRefresh_ReusedRevokedToken_RevokesFamilyAndReturnsInvalid(t *testing.T) {
	mockRepo := new(MockUserRepository)
	refreshRepo := new(MockRefreshTokenRepository)
	authUseCase := newAuthUseCase(mockRepo, refreshRepo)

	revokedAt := time.Now().Add(-time.Minute)
	familyID := uuid.New()
	stored := &domain.RefreshToken{
		ID:        uuid.New(),
		UserID:    uuid.New(),
		FamilyID:  familyID,
		ExpiresAt: time.Now().Add(time.Hour),
		RevokedAt: &revokedAt,
	}
	refreshRepo.On("GetByHash", mock.AnythingOfType("[]uint8")).Return(stored, nil)
	refreshRepo.On("RevokeFamily", familyID).Return(nil)

	_, accessToken, newRefreshToken, err := authUseCase.Refresh("stolen-token")

	assert.ErrorIs(t, err, domain.ErrRefreshTokenInvalid)
	assert.Empty(t, accessToken)
	assert.Empty(t, newRefreshToken)
	refreshRepo.AssertExpectations(t)
}

// Ответ на предыдущий refresh не дошёл до клиента: он предъявляет тот же токен
// снова через пару секунд. Это не кража — сессию жечь нельзя, надо просто
// выдать новую пару ещё раз.
func TestRefresh_ReuseWithinGraceWindow_RotatesAgainInsteadOfRevoking(t *testing.T) {
	mockRepo := new(MockUserRepository)
	refreshRepo := new(MockRefreshTokenRepository)
	authUseCase := newAuthUseCase(mockRepo, refreshRepo)

	userID := uuid.New()
	storedID := uuid.New()
	revokedAt := time.Now().Add(-5 * time.Second)
	replacedBy := uuid.New()
	stored := &domain.RefreshToken{
		ID:         storedID,
		UserID:     userID,
		FamilyID:   uuid.New(),
		ExpiresAt:  time.Now().Add(time.Hour),
		RevokedAt:  &revokedAt,
		ReplacedBy: &replacedBy,
	}

	refreshRepo.On("GetByHash", mock.AnythingOfType("[]uint8")).Return(stored, nil)
	// Преемник жив (RevokedAt == nil) — family не гасили после ротации,
	// значит grace-окно применимо.
	refreshRepo.On("GetByID", replacedBy).Return(&domain.RefreshToken{
		ID:        replacedBy,
		UserID:    userID,
		FamilyID:  stored.FamilyID,
		ExpiresAt: time.Now().Add(time.Hour),
	}, nil)
	mockRepo.On("GetByID", userID).Return(&domain.User{ID: userID, Username: "testuser"}, nil)
	refreshRepo.On("Create", mock.AnythingOfType("*domain.RefreshToken")).Return(nil)
	refreshRepo.On("MarkRotated", storedID, mock.AnythingOfType("uuid.UUID"), mock.AnythingOfType("time.Time")).Return(nil)
	// RevokeFamily намеренно НЕ заявлен: вызов незаявленного метода уронит мок —
	// именно так мы доказываем, что family не отзывается.

	user, accessToken, newRefreshToken, err := authUseCase.Refresh("retried-refresh-token")

	assert.NoError(t, err)
	assert.NotNil(t, user)
	assert.NotEmpty(t, accessToken)
	assert.NotEmpty(t, newRefreshToken)
	refreshRepo.AssertExpectations(t)
	refreshRepo.AssertNotCalled(t, "RevokeFamily", mock.Anything)
}

func TestRefresh_ReuseOutsideGraceWindow_StillRevokesFamily(t *testing.T) {
	mockRepo := new(MockUserRepository)
	refreshRepo := new(MockRefreshTokenRepository)
	authUseCase := newAuthUseCase(mockRepo, refreshRepo)

	familyID := uuid.New()
	revokedAt := time.Now().Add(-time.Hour)
	replacedBy := uuid.New()
	stored := &domain.RefreshToken{
		ID:         uuid.New(),
		UserID:     uuid.New(),
		FamilyID:   familyID,
		ExpiresAt:  time.Now().Add(time.Hour),
		RevokedAt:  &revokedAt,
		ReplacedBy: &replacedBy,
	}

	refreshRepo.On("GetByHash", mock.AnythingOfType("[]uint8")).Return(stored, nil)
	refreshRepo.On("RevokeFamily", familyID).Return(nil)

	_, accessToken, newRefreshToken, err := authUseCase.Refresh("stolen-token")

	assert.ErrorIs(t, err, domain.ErrRefreshTokenInvalid)
	assert.Empty(t, accessToken)
	assert.Empty(t, newRefreshToken)
	refreshRepo.AssertExpectations(t)
}

// Логаут гасит family через RevokeFamily, а тот трогает только строки с
// revoked_at IS NULL — уже ротированный токен он не задевает. Предъявление
// такого токена внутри grace-окна не должно воскрешать погашенную сессию:
// признак того, что family погасили после ротации, — отозванный преемник.
func TestRefresh_ReuseWithinGraceWindow_ButSuccessorAlreadyRevoked_StillRevokesFamily(t *testing.T) {
	mockRepo := new(MockUserRepository)
	refreshRepo := new(MockRefreshTokenRepository)
	authUseCase := newAuthUseCase(mockRepo, refreshRepo)

	userID := uuid.New()
	familyID := uuid.New()
	revokedAt := time.Now().Add(-5 * time.Second)
	replacedBy := uuid.New()
	stored := &domain.RefreshToken{
		ID:         uuid.New(),
		UserID:     userID,
		FamilyID:   familyID,
		ExpiresAt:  time.Now().Add(time.Hour),
		RevokedAt:  &revokedAt,
		ReplacedBy: &replacedBy,
	}

	successorRevokedAt := time.Now().Add(-2 * time.Second)
	refreshRepo.On("GetByHash", mock.AnythingOfType("[]uint8")).Return(stored, nil)
	refreshRepo.On("GetByID", replacedBy).Return(&domain.RefreshToken{
		ID:        replacedBy,
		UserID:    userID,
		FamilyID:  familyID,
		ExpiresAt: time.Now().Add(time.Hour),
		RevokedAt: &successorRevokedAt,
	}, nil)
	refreshRepo.On("RevokeFamily", familyID).Return(nil)

	_, accessToken, newRefreshToken, err := authUseCase.Refresh("token-from-logged-out-session")

	assert.ErrorIs(t, err, domain.ErrRefreshTokenInvalid)
	assert.Empty(t, accessToken)
	assert.Empty(t, newRefreshToken)
	refreshRepo.AssertExpectations(t)
	// Никакой новой пары в погашенной family: Create/MarkRotated не заявлены,
	// и вызов любого из них уронил бы мок.
	refreshRepo.AssertNotCalled(t, "Create", mock.Anything)
	refreshRepo.AssertNotCalled(t, "MarkRotated", mock.Anything, mock.Anything, mock.Anything)
}

// Сбой похода в БД за преемником — это инфраструктурная ошибка, а не вердикт
// «токен невалиден». Путать их нельзя: ровно из-за такой подмены (любой сбой
// БД => 401 => логаут) и появилась эта фича, см. VYC-54.
func TestRefresh_GraceWindowSuccessorLookupFails_PropagatesError(t *testing.T) {
	mockRepo := new(MockUserRepository)
	refreshRepo := new(MockRefreshTokenRepository)
	authUseCase := newAuthUseCase(mockRepo, refreshRepo)

	revokedAt := time.Now().Add(-5 * time.Second)
	replacedBy := uuid.New()
	stored := &domain.RefreshToken{
		ID:         uuid.New(),
		UserID:     uuid.New(),
		FamilyID:   uuid.New(),
		ExpiresAt:  time.Now().Add(time.Hour),
		RevokedAt:  &revokedAt,
		ReplacedBy: &replacedBy,
	}

	refreshRepo.On("GetByHash", mock.AnythingOfType("[]uint8")).Return(stored, nil)
	refreshRepo.On("GetByID", replacedBy).Return(nil, errors.New("connection refused"))

	_, accessToken, newRefreshToken, err := authUseCase.Refresh("some-token")

	assert.Error(t, err)
	assert.False(t, errors.Is(err, domain.ErrRefreshTokenInvalid), "an infra error must not be reported as an invalid token")
	assert.Contains(t, err.Error(), "connection refused")
	assert.Empty(t, accessToken)
	assert.Empty(t, newRefreshToken)
	refreshRepo.AssertExpectations(t)
	// Сомнительный, но недоказанный случай не должен жечь сессию.
	refreshRepo.AssertNotCalled(t, "RevokeFamily", mock.Anything)
}

// Токен, отозванный без преемника (Logout → RevokeFamily), под grace-окно
// не подпадает даже будучи отозванным секунду назад.
func TestRefresh_RevokedWithoutSuccessor_RevokesFamilyRegardlessOfAge(t *testing.T) {
	mockRepo := new(MockUserRepository)
	refreshRepo := new(MockRefreshTokenRepository)
	authUseCase := newAuthUseCase(mockRepo, refreshRepo)

	familyID := uuid.New()
	revokedAt := time.Now().Add(-1 * time.Second)
	stored := &domain.RefreshToken{
		ID:        uuid.New(),
		UserID:    uuid.New(),
		FamilyID:  familyID,
		ExpiresAt: time.Now().Add(time.Hour),
		RevokedAt: &revokedAt,
	}

	refreshRepo.On("GetByHash", mock.AnythingOfType("[]uint8")).Return(stored, nil)
	refreshRepo.On("RevokeFamily", familyID).Return(nil)

	_, accessToken, newRefreshToken, err := authUseCase.Refresh("logged-out-token")

	assert.ErrorIs(t, err, domain.ErrRefreshTokenInvalid)
	assert.Empty(t, accessToken)
	assert.Empty(t, newRefreshToken)
	refreshRepo.AssertExpectations(t)
}

func TestRefresh_RepoError_DoesNotReturnInvalidTokenError(t *testing.T) {
	mockRepo := new(MockUserRepository)
	refreshRepo := new(MockRefreshTokenRepository)
	authUseCase := newAuthUseCase(mockRepo, refreshRepo)

	refreshRepo.On("GetByHash", mock.AnythingOfType("[]uint8")).Return(nil, errors.New("connection refused"))

	_, accessToken, newRefreshToken, err := authUseCase.Refresh("some-token")

	assert.Error(t, err)
	assert.False(t, errors.Is(err, domain.ErrRefreshTokenInvalid), "an infra error must not be reported as an invalid token")
	assert.Contains(t, err.Error(), "failed to look up refresh token")
	assert.Contains(t, err.Error(), "connection refused")
	assert.Empty(t, accessToken)
	assert.Empty(t, newRefreshToken)
	refreshRepo.AssertExpectations(t)
}

func TestLogout_RevokesFamily(t *testing.T) {
	mockRepo := new(MockUserRepository)
	refreshRepo := new(MockRefreshTokenRepository)
	authUseCase := newAuthUseCase(mockRepo, refreshRepo)

	familyID := uuid.New()
	stored := &domain.RefreshToken{ID: uuid.New(), FamilyID: familyID}
	refreshRepo.On("GetByHash", mock.AnythingOfType("[]uint8")).Return(stored, nil)
	refreshRepo.On("RevokeFamily", familyID).Return(nil)

	err := authUseCase.Logout("some-refresh-token")

	assert.NoError(t, err)
	refreshRepo.AssertExpectations(t)
}

func TestLogout_UnknownToken_IsNotAnError(t *testing.T) {
	mockRepo := new(MockUserRepository)
	refreshRepo := new(MockRefreshTokenRepository)
	authUseCase := newAuthUseCase(mockRepo, refreshRepo)

	refreshRepo.On("GetByHash", mock.AnythingOfType("[]uint8")).Return(nil, domain.ErrRefreshTokenNotFound)

	err := authUseCase.Logout("unknown-token")

	assert.NoError(t, err)
}

func TestLogout_RepoError_DoesNotReturnInvalidTokenError(t *testing.T) {
	mockRepo := new(MockUserRepository)
	refreshRepo := new(MockRefreshTokenRepository)
	authUseCase := newAuthUseCase(mockRepo, refreshRepo)

	refreshRepo.On("GetByHash", mock.AnythingOfType("[]uint8")).Return(nil, errors.New("connection refused"))

	err := authUseCase.Logout("some-token")

	assert.Error(t, err)
	assert.False(t, errors.Is(err, domain.ErrRefreshTokenInvalid), "an infra error must not be reported as an invalid token")
	refreshRepo.AssertExpectations(t)
}

// Регрессия: перезапись брошенной регистрации ограничена по частоте только
// кулдауном отправки кода, поэтому Update обязан стоять ПОСЛЕ RequestCode.
// При обратном порядке любой, кто знает чужой неподтверждённый адрес, в цикле
// переписывал бы жертве username и хеш пароля: отказ по лимиту приходил бы
// уже после того, как перезапись состоялась.
func TestRegisterThrottledDoesNotOverwritePendingRegistration(t *testing.T) {
	userRepo := new(MockUserRepository)
	refreshRepo := new(MockRefreshTokenRepository)
	sender := new(MockOTPSender)
	victim := &domain.User{ID: uuid.New(), Username: "victim", Email: "victim@e.com"}
	userRepo.On("GetByEmail", "victim@e.com").Return(victim, nil)
	userRepo.On("GetByUsername", "attacker").Return(nil, errors.New("not found"))
	sender.On("RequestCode", "victim@e.com", domain.OTPPurposeRegistration).
		Return(&domain.OTPThrottledError{RetryAfter: 42 * time.Second})

	uc := usecase.NewAuthUseCase(userRepo, refreshRepo, sender, "s", time.Minute, time.Hour)
	user, err := uc.Register("attacker", "victim@e.com", "attackerpass")

	var throttled *domain.OTPThrottledError
	require.True(t, errors.As(err, &throttled), "отказ по лимиту должен доезжать до вызывающего")
	assert.Nil(t, user)
	userRepo.AssertNotCalled(t, "Update", mock.Anything, mock.Anything)
	userRepo.AssertNotCalled(t, "Create", mock.Anything)
}
