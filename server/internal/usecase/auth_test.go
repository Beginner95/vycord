package usecase_test

import (
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"

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

func (m *MockRefreshTokenRepository) MarkRotated(id, replacedBy uuid.UUID, revokedAt time.Time) error {
	args := m.Called(id, replacedBy, revokedAt)
	return args.Error(0)
}

func (m *MockRefreshTokenRepository) RevokeFamily(familyID uuid.UUID) error {
	args := m.Called(familyID)
	return args.Error(0)
}

func newAuthUseCase(userRepo *MockUserRepository, refreshRepo *MockRefreshTokenRepository) domain.AuthUseCase {
	return usecase.NewAuthUseCase(userRepo, refreshRepo, "test-secret", 24*time.Hour, 30*24*time.Hour)
}

func TestRegister_UserAlreadyExistsWithEmail(t *testing.T) {
	mockRepo := new(MockUserRepository)
	refreshRepo := new(MockRefreshTokenRepository)
	authUseCase := newAuthUseCase(mockRepo, refreshRepo)

	mockRepo.On("GetByEmail", "test@example.com").Return(&domain.User{}, nil)

	user, accessToken, refreshToken, err := authUseCase.Register("testuser", "test@example.com", "password123")

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "user with this email already exists")
	assert.Nil(t, user)
	assert.Empty(t, accessToken)
	assert.Empty(t, refreshToken)
	mockRepo.AssertExpectations(t)
}

func TestRegister_UserAlreadyExistsByUsername(t *testing.T) {
	mockRepo := new(MockUserRepository)
	refreshRepo := new(MockRefreshTokenRepository)
	authUseCase := newAuthUseCase(mockRepo, refreshRepo)

	mockRepo.On("GetByEmail", "test@example.com").Return((*domain.User)(nil), errors.New("user not found"))
	mockRepo.On("GetByUsername", "testuser").Return(&domain.User{}, nil)

	user, accessToken, refreshToken, err := authUseCase.Register("testuser", "test@example.com", "password123")

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "user with this username already exists")
	assert.Nil(t, user)
	assert.Empty(t, accessToken)
	assert.Empty(t, refreshToken)
	mockRepo.AssertExpectations(t)
}

func TestRegister_Success(t *testing.T) {
	mockRepo := new(MockUserRepository)
	refreshRepo := new(MockRefreshTokenRepository)
	authUseCase := newAuthUseCase(mockRepo, refreshRepo)

	mockRepo.On("GetByEmail", "test@example.com").Return((*domain.User)(nil), errors.New("user not found"))
	mockRepo.On("GetByUsername", "testuser").Return((*domain.User)(nil), errors.New("user not found"))
	mockRepo.On("Create", mock.MatchedBy(func(u *domain.User) bool {
		return u.Username == "testuser" && u.Email == "test@example.com"
	})).Return(nil)
	refreshRepo.On("Create", mock.AnythingOfType("*domain.RefreshToken")).Return(nil)

	user, accessToken, refreshToken, err := authUseCase.Register("testuser", "test@example.com", "password123")

	assert.NoError(t, err)
	assert.NotNil(t, user)
	assert.Empty(t, user.Password)
	assert.NotEmpty(t, accessToken)
	assert.NotEmpty(t, refreshToken)
	mockRepo.AssertExpectations(t)
	refreshRepo.AssertExpectations(t)
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
