package usecase_test

import (
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
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

func (m *MockUserRepository) UpdateLastSeen(id uuid.UUID, at time.Time) error {
	return m.Called(id, at).Error(0)
}

func (m *MockUserRepository) GetLastSeenBatch(ids []uuid.UUID) (map[uuid.UUID]domain.LastSeenInfo, error) {
	args := m.Called(ids)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(map[uuid.UUID]domain.LastSeenInfo), args.Error(1)
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

func newAuthUseCase(userRepo *MockUserRepository, refreshRepo *MockRefreshTokenRepository) domain.AuthUseCase {
	return usecase.NewAuthUseCase(userRepo, refreshRepo, "test-secret", 24*time.Hour, 30*24*time.Hour)
}

func TestLoginRejectsUnverified(t *testing.T) {
	userRepo := new(MockUserRepository)
	refreshRepo := new(MockRefreshTokenRepository)
	hashed, _ := bcrypt.GenerateFromPassword([]byte("password123"), bcrypt.DefaultCost)
	userRepo.On("GetByEmail", "u@e.com").Return(&domain.User{
		ID: uuid.New(), Email: "u@e.com", Password: string(hashed),
	}, nil)

	uc := newAuthUseCase(userRepo, refreshRepo)
	_, _, _, err := uc.Login("u@e.com", "password123")

	assert.ErrorIs(t, err, domain.ErrEmailNotVerified)
}

// TestLogin_PropagatesShowLastSeenFromRepository guards against a regression
// where GetByEmail's SELECT/Scan (repository/postgres/user.go) forgets to
// load show_last_seen: Go zero-values an un-scanned bool to false, so a user
// who *disabled* last-seen would silently look like they had it enabled (and
// vice versa for anyone else) the moment Login's result reaches the client
// and gets persisted into authStore. This test only exercises the usecase
// against a mock repo — it can't catch a wrong SQL SELECT list by itself —
// but it does pin the invariant that Login must not drop or reset
// ShowLastSeen once the repository returns it.
func TestLogin_PropagatesShowLastSeenFromRepository(t *testing.T) {
	mockRepo := new(MockUserRepository)
	refreshRepo := new(MockRefreshTokenRepository)
	authUseCase := newAuthUseCase(mockRepo, refreshRepo)

	hashed, _ := bcrypt.GenerateFromPassword([]byte("password123"), bcrypt.DefaultCost)
	verifiedAt := time.Now().Add(-time.Hour)
	mockRepo.On("GetByEmail", "u@e.com").Return(&domain.User{
		ID:              uuid.New(),
		Email:           "u@e.com",
		Password:        string(hashed),
		EmailVerifiedAt: &verifiedAt,
		ShowLastSeen:    false,
	}, nil)
	refreshRepo.On("Create", mock.AnythingOfType("*domain.RefreshToken")).Return(nil)

	user, _, _, err := authUseCase.Login("u@e.com", "password123")

	assert.NoError(t, err)
	if assert.NotNil(t, user) {
		assert.False(t, user.ShowLastSeen, "expected Login to propagate show_last_seen=false as returned by the repository, not zero-value it")
	}
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
	refreshRepo.On("GetByID", replacedBy).Return(&domain.RefreshToken{
		ID:        replacedBy,
		UserID:    userID,
		FamilyID:  stored.FamilyID,
		ExpiresAt: time.Now().Add(time.Hour),
	}, nil)
	mockRepo.On("GetByID", userID).Return(&domain.User{ID: userID, Username: "testuser"}, nil)
	refreshRepo.On("Create", mock.AnythingOfType("*domain.RefreshToken")).Return(nil)
	refreshRepo.On("MarkRotated", storedID, mock.AnythingOfType("uuid.UUID"), mock.AnythingOfType("time.Time")).Return(nil)

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
	refreshRepo.AssertNotCalled(t, "Create", mock.Anything)
	refreshRepo.AssertNotCalled(t, "MarkRotated", mock.Anything, mock.Anything, mock.Anything)
}

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
	refreshRepo.AssertNotCalled(t, "RevokeFamily", mock.Anything)
}

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
