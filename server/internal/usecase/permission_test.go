package usecase_test

import (
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"

	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/internal/usecase"
)

// MockRoleRepository — мок domain.RoleRepository, общий для тестов пакета.
type MockRoleRepository struct {
	mock.Mock
}

func (m *MockRoleRepository) ListByServer(serverID uuid.UUID) ([]*domain.Role, error) {
	args := m.Called(serverID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).([]*domain.Role), args.Error(1)
}

func (m *MockRoleRepository) GetByID(id uuid.UUID) (*domain.Role, error) {
	args := m.Called(id)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*domain.Role), args.Error(1)
}

func (m *MockRoleRepository) Create(role *domain.Role) error {
	return m.Called(role).Error(0)
}

func (m *MockRoleRepository) Update(id uuid.UUID, updates map[string]interface{}) error {
	return m.Called(id, updates).Error(0)
}

func (m *MockRoleRepository) Delete(id uuid.UUID) error {
	return m.Called(id).Error(0)
}

func (m *MockRoleRepository) ResolveMemberPermissions(serverID, userID uuid.UUID) (domain.Permission, int, error) {
	args := m.Called(serverID, userID)
	return args.Get(0).(domain.Permission), args.Int(1), args.Error(2)
}

func (m *MockRoleRepository) AssignToMember(serverID, userID, roleID uuid.UUID) error {
	return m.Called(serverID, userID, roleID).Error(0)
}

func (m *MockRoleRepository) UnassignFromMember(serverID, userID, roleID uuid.UUID) error {
	return m.Called(serverID, userID, roleID).Error(0)
}

func TestResolve_Owner_ShortCircuits(t *testing.T) {
	serverID, ownerID := uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	roleRepo := new(MockRoleRepository)
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID}, nil)
	roleRepo.On("ResolveMemberPermissions", serverID, ownerID).Return(domain.PermViewChannels|domain.PermSendMessages, 0, nil)

	uc := usecase.NewPermissionUseCase(srvRepo, roleRepo)
	ps, err := uc.Resolve(serverID, ownerID)

	require.NoError(t, err)
	assert.True(t, ps.IsOwner)
	assert.True(t, ps.Has(domain.PermManageRoles), "владелец имеет любое право независимо от битов")
	srvRepo.AssertNotCalled(t, "IsMember", mock.Anything, mock.Anything)
}

func TestResolve_Member_EveryoneAppliesImplicitly(t *testing.T) {
	serverID, ownerID, userID := uuid.New(), uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	roleRepo := new(MockRoleRepository)
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID}, nil)
	srvRepo.On("IsMember", serverID, userID).Return(true, nil)
	// Назначенных ролей нет — приходят только права @everyone с позицией 0.
	roleRepo.On("ResolveMemberPermissions", serverID, userID).Return(domain.PermViewChannels|domain.PermSendMessages, 0, nil)

	uc := usecase.NewPermissionUseCase(srvRepo, roleRepo)
	ps, err := uc.Resolve(serverID, userID)

	require.NoError(t, err)
	assert.False(t, ps.IsOwner)
	assert.True(t, ps.Has(domain.PermViewChannels))
	assert.True(t, ps.Has(domain.PermSendMessages))
	assert.False(t, ps.Has(domain.PermManageChannels))
	assert.Equal(t, 0, ps.HighestPosition)
}

func TestResolve_Member_MultipleRolesUnion(t *testing.T) {
	serverID, ownerID, userID := uuid.New(), uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	roleRepo := new(MockRoleRepository)
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID}, nil)
	srvRepo.On("IsMember", serverID, userID).Return(true, nil)
	// @everyone(16|32) + «Модератор»(8) + «Хостер»(2), высшая позиция — 3.
	union := domain.PermViewChannels | domain.PermSendMessages | domain.PermManageChannels | domain.PermManageServer
	roleRepo.On("ResolveMemberPermissions", serverID, userID).Return(union, 3, nil)

	uc := usecase.NewPermissionUseCase(srvRepo, roleRepo)
	ps, err := uc.Resolve(serverID, userID)

	require.NoError(t, err)
	assert.True(t, ps.Has(domain.PermManageChannels))
	assert.True(t, ps.Has(domain.PermManageServer))
	assert.False(t, ps.Has(domain.PermManageRoles), "право, которого не даёт ни одна роль, не появляется")
	assert.Equal(t, 3, ps.HighestPosition)
}

func TestResolve_NotMember_EmptySet(t *testing.T) {
	serverID, ownerID, strangerID := uuid.New(), uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	roleRepo := new(MockRoleRepository)
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID}, nil)
	srvRepo.On("IsMember", serverID, strangerID).Return(false, nil)

	uc := usecase.NewPermissionUseCase(srvRepo, roleRepo)
	ps, err := uc.Resolve(serverID, strangerID)

	require.NoError(t, err)
	assert.False(t, ps.IsOwner)
	assert.False(t, ps.Has(domain.PermViewChannels))
	assert.Equal(t, -1, ps.HighestPosition)
	roleRepo.AssertNotCalled(t, "ResolveMemberPermissions", mock.Anything, mock.Anything)
}

func TestResolve_ServerNotFound(t *testing.T) {
	serverID, userID := uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	roleRepo := new(MockRoleRepository)
	srvRepo.On("GetByID", serverID).Return(nil, assertAnyError)

	uc := usecase.NewPermissionUseCase(srvRepo, roleRepo)
	_, err := uc.Resolve(serverID, userID)

	assert.ErrorIs(t, err, domain.ErrServerNotFound)
}

// assertAnyError — произвольная ошибка репозитория для проверки трансляции.
var assertAnyError = errors.New("db is down")
