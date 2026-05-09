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

func TestRegister_UserAlreadyExistsWithEmail(t *testing.T) {
	mockRepo := new(MockUserRepository)
	authUseCase := usecase.NewAuthUseCase(mockRepo, "test-secret", 24*time.Hour)

	mockRepo.On("GetByEmail", "test@example.com").Return(&domain.User{}, nil)

	user, token, err := authUseCase.Register("testuser", "test@example.com", "password123")

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "user with this email already exists")
	assert.Nil(t, user)
	assert.Empty(t, token)
	mockRepo.AssertExpectations(t)
}

func TestRegister_UserAlreadyExistsByUsername(t *testing.T) {
	mockRepo := new(MockUserRepository)
	authUseCase := usecase.NewAuthUseCase(mockRepo, "test-secret", 24*time.Hour)

	mockRepo.On("GetByEmail", "test@example.com").Return((*domain.User)(nil), errors.New("user not found"))
	mockRepo.On("GetByUsername", "testuser").Return(&domain.User{}, nil)

	user, token, err := authUseCase.Register("testuser", "test@example.com", "password123")

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "user with this username already exists")
	assert.Nil(t, user)
	assert.Empty(t, token)
	mockRepo.AssertExpectations(t)
}

func TestRegister_Success(t *testing.T) {
	mockRepo := new(MockUserRepository)
	authUseCase := usecase.NewAuthUseCase(mockRepo, "test-secret", 24*time.Hour)

	mockRepo.On("GetByEmail", "test@example.com").Return((*domain.User)(nil), errors.New("user not found"))
	mockRepo.On("GetByUsername", "testuser").Return((*domain.User)(nil), errors.New("user not found"))
	mockRepo.On("Create", mock.MatchedBy(func(u *domain.User) bool {
		return u.Username == "testuser" && u.Email == "test@example.com"
	})).Return(nil)

	user, token, err := authUseCase.Register("testuser", "test@example.com", "password123")

	assert.NoError(t, err)
	assert.NotNil(t, user)
	assert.Empty(t, user.Password)
	assert.NotEmpty(t, token)
	mockRepo.AssertExpectations(t)
}

func TestLogin_InvalidCredentials(t *testing.T) {
	mockRepo := new(MockUserRepository)
	authUseCase := usecase.NewAuthUseCase(mockRepo, "test-secret", 24*time.Hour)

	mockRepo.On("GetByEmail", "wrong@example.com").Return((*domain.User)(nil), errors.New("user not found"))

	user, token, err := authUseCase.Login("wrong@example.com", "password123")

	assert.Error(t, err)
	assert.Nil(t, user)
	assert.Empty(t, token)
	mockRepo.AssertExpectations(t)
}
