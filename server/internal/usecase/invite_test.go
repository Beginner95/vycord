package usecase_test

import (
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"

	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/internal/usecase"
)

type MockInviteRepository struct{ mock.Mock }

func (m *MockInviteRepository) Create(invite *domain.Invite) error {
	return m.Called(invite).Error(0)
}
func (m *MockInviteRepository) GetByCode(code string) (*domain.Invite, error) {
	args := m.Called(code)
	inv, _ := args.Get(0).(*domain.Invite)
	return inv, args.Error(1)
}
func (m *MockInviteRepository) ListByServer(serverID uuid.UUID) ([]*domain.Invite, error) {
	args := m.Called(serverID)
	inv, _ := args.Get(0).([]*domain.Invite)
	return inv, args.Error(1)
}
func (m *MockInviteRepository) IncrementUses(code string) error {
	return m.Called(code).Error(0)
}
func (m *MockInviteRepository) Delete(code string) error {
	return m.Called(code).Error(0)
}

func TestCreateInvite_WithPermission_Success(t *testing.T) {
	serverID, userID := uuid.New(), uuid.New()

	inviteRepo := new(MockInviteRepository)
	inviteRepo.On("Create", mock.AnythingOfType("*domain.Invite")).Return(nil)
	perms := permsWith(serverID, userID, domain.PermCreateInvite)

	uc := usecase.NewInviteUseCase(inviteRepo, new(MockServerRepository), perms)
	invite, err := uc.CreateInvite(serverID, userID)

	require.NoError(t, err)
	assert.Equal(t, serverID, invite.ServerID)
	assert.Equal(t, userID, invite.CreatedBy)
}

func TestCreateInvite_WithoutPermission_Forbidden(t *testing.T) {
	serverID, userID := uuid.New(), uuid.New()

	inviteRepo := new(MockInviteRepository)
	perms := permsWith(serverID, userID, 0)

	uc := usecase.NewInviteUseCase(inviteRepo, new(MockServerRepository), perms)
	invite, err := uc.CreateInvite(serverID, userID)

	assert.Nil(t, invite)
	assert.ErrorIs(t, err, domain.ErrInviteForbidden)
	inviteRepo.AssertNotCalled(t, "Create", mock.Anything)
}

func TestListInvites_PlainCreator_SeesOnlyOwn(t *testing.T) {
	serverID, userID, otherID := uuid.New(), uuid.New(), uuid.New()

	inviteRepo := new(MockInviteRepository)
	all := []*domain.Invite{
		{Code: "own1", ServerID: serverID, CreatedBy: userID},
		{Code: "other1", ServerID: serverID, CreatedBy: otherID},
	}
	inviteRepo.On("ListByServer", serverID).Return(all, nil)
	perms := permsWith(serverID, userID, domain.PermCreateInvite)

	uc := usecase.NewInviteUseCase(inviteRepo, new(MockServerRepository), perms)
	got, err := uc.ListInvites(serverID, userID)

	require.NoError(t, err)
	require.Len(t, got, 1)
	assert.Equal(t, "own1", got[0].Code)
}

func TestListInvites_ManageServer_SeesAll(t *testing.T) {
	serverID, userID, otherID := uuid.New(), uuid.New(), uuid.New()

	inviteRepo := new(MockInviteRepository)
	all := []*domain.Invite{
		{Code: "own1", ServerID: serverID, CreatedBy: userID},
		{Code: "other1", ServerID: serverID, CreatedBy: otherID},
	}
	inviteRepo.On("ListByServer", serverID).Return(all, nil)
	perms := permsWith(serverID, userID, domain.PermManageServer)

	uc := usecase.NewInviteUseCase(inviteRepo, new(MockServerRepository), perms)
	got, err := uc.ListInvites(serverID, userID)

	require.NoError(t, err)
	assert.Len(t, got, 2)
}

func TestListInvites_WithoutPermission_Forbidden(t *testing.T) {
	serverID, userID := uuid.New(), uuid.New()

	inviteRepo := new(MockInviteRepository)
	perms := permsWith(serverID, userID, 0)

	uc := usecase.NewInviteUseCase(inviteRepo, new(MockServerRepository), perms)
	got, err := uc.ListInvites(serverID, userID)

	assert.Nil(t, got)
	assert.ErrorIs(t, err, domain.ErrInviteForbidden)
	inviteRepo.AssertNotCalled(t, "ListByServer", mock.Anything)
}

func TestRevokeInvite_Author_Success(t *testing.T) {
	serverID, userID := uuid.New(), uuid.New()

	inviteRepo := new(MockInviteRepository)
	inviteRepo.On("GetByCode", "abc123").Return(&domain.Invite{Code: "abc123", ServerID: serverID, CreatedBy: userID}, nil)
	inviteRepo.On("Delete", "abc123").Return(nil)
	perms := permsWith(serverID, userID, domain.PermCreateInvite)

	uc := usecase.NewInviteUseCase(inviteRepo, new(MockServerRepository), perms)
	err := uc.RevokeInvite(serverID, "abc123", userID)

	require.NoError(t, err)
	inviteRepo.AssertCalled(t, "Delete", "abc123")
}

func TestRevokeInvite_ManageServerNotAuthor_Success(t *testing.T) {
	serverID, userID, authorID := uuid.New(), uuid.New(), uuid.New()

	inviteRepo := new(MockInviteRepository)
	inviteRepo.On("GetByCode", "abc123").Return(&domain.Invite{Code: "abc123", ServerID: serverID, CreatedBy: authorID}, nil)
	inviteRepo.On("Delete", "abc123").Return(nil)
	perms := permsWith(serverID, userID, domain.PermManageServer)

	uc := usecase.NewInviteUseCase(inviteRepo, new(MockServerRepository), perms)
	err := uc.RevokeInvite(serverID, "abc123", userID)

	require.NoError(t, err)
}

func TestRevokeInvite_PlainNonAuthor_Forbidden(t *testing.T) {
	serverID, userID, authorID := uuid.New(), uuid.New(), uuid.New()

	inviteRepo := new(MockInviteRepository)
	inviteRepo.On("GetByCode", "abc123").Return(&domain.Invite{Code: "abc123", ServerID: serverID, CreatedBy: authorID}, nil)
	perms := permsWith(serverID, userID, domain.PermCreateInvite)

	uc := usecase.NewInviteUseCase(inviteRepo, new(MockServerRepository), perms)
	err := uc.RevokeInvite(serverID, "abc123", userID)

	assert.ErrorIs(t, err, domain.ErrInviteForbidden)
	inviteRepo.AssertNotCalled(t, "Delete", mock.Anything)
}

func TestRevokeInvite_WrongServer_NotFound(t *testing.T) {
	serverID, otherServerID, userID := uuid.New(), uuid.New(), uuid.New()

	inviteRepo := new(MockInviteRepository)
	inviteRepo.On("GetByCode", "abc123").Return(&domain.Invite{Code: "abc123", ServerID: otherServerID, CreatedBy: userID}, nil)

	uc := usecase.NewInviteUseCase(inviteRepo, new(MockServerRepository), new(MockPermissionUseCase))
	err := uc.RevokeInvite(serverID, "abc123", userID)

	assert.ErrorIs(t, err, domain.ErrInviteNotFound)
}

func TestPreviewInvite_Valid_ReturnsPreview(t *testing.T) {
	serverID, code := uuid.New(), "abc123"

	inviteRepo := new(MockInviteRepository)
	inviteRepo.On("GetByCode", code).Return(&domain.Invite{Code: code, ServerID: serverID}, nil)

	srvRepo := new(MockServerRepository)
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, Name: "Мой сервер"}, nil)
	srvRepo.On("GetMembersWithUsers", serverID).Return([]*domain.MemberWithUser{{}, {}}, nil)

	uc := usecase.NewInviteUseCase(inviteRepo, srvRepo, new(MockPermissionUseCase))
	preview, err := uc.PreviewInvite(code)

	require.NoError(t, err)
	assert.Equal(t, "Мой сервер", preview.ServerName)
	assert.Equal(t, 2, preview.MemberCount)
}

func TestPreviewInvite_Expired_NotFound(t *testing.T) {
	code := "abc123"
	past := time.Now().Add(-time.Hour)

	inviteRepo := new(MockInviteRepository)
	inviteRepo.On("GetByCode", code).Return(&domain.Invite{Code: code, ExpiresAt: &past}, nil)

	uc := usecase.NewInviteUseCase(inviteRepo, new(MockServerRepository), new(MockPermissionUseCase))
	preview, err := uc.PreviewInvite(code)

	assert.Nil(t, preview)
	assert.ErrorIs(t, err, domain.ErrInviteNotFound)
}

func TestPreviewInvite_ExhaustedUses_NotFound(t *testing.T) {
	code := "abc123"
	max := 1

	inviteRepo := new(MockInviteRepository)
	inviteRepo.On("GetByCode", code).Return(&domain.Invite{Code: code, MaxUses: &max, Uses: 1}, nil)

	uc := usecase.NewInviteUseCase(inviteRepo, new(MockServerRepository), new(MockPermissionUseCase))
	preview, err := uc.PreviewInvite(code)

	assert.Nil(t, preview)
	assert.ErrorIs(t, err, domain.ErrInviteNotFound)
}

func TestJoinViaInvite_NewMember_AddsAndIncrements(t *testing.T) {
	serverID, userID, code := uuid.New(), uuid.New(), "abc123"

	inviteRepo := new(MockInviteRepository)
	inviteRepo.On("GetByCode", code).Return(&domain.Invite{Code: code, ServerID: serverID}, nil)
	inviteRepo.On("IncrementUses", code).Return(nil)

	srvRepo := new(MockServerRepository)
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: uuid.New()}, nil)
	srvRepo.On("IsMember", serverID, userID).Return(false, nil)
	srvRepo.On("AddMember", serverID, userID).Return(nil)

	uc := usecase.NewInviteUseCase(inviteRepo, srvRepo, new(MockPermissionUseCase))
	server, err := uc.JoinViaInvite(code, userID)

	require.NoError(t, err)
	assert.Equal(t, serverID, server.ID)
	srvRepo.AssertCalled(t, "AddMember", serverID, userID)
	inviteRepo.AssertCalled(t, "IncrementUses", code)
}

func TestJoinViaInvite_AlreadyMember_NoOp(t *testing.T) {
	serverID, userID, code := uuid.New(), uuid.New(), "abc123"

	inviteRepo := new(MockInviteRepository)
	inviteRepo.On("GetByCode", code).Return(&domain.Invite{Code: code, ServerID: serverID}, nil)

	srvRepo := new(MockServerRepository)
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: uuid.New()}, nil)
	srvRepo.On("IsMember", serverID, userID).Return(true, nil)

	uc := usecase.NewInviteUseCase(inviteRepo, srvRepo, new(MockPermissionUseCase))
	server, err := uc.JoinViaInvite(code, userID)

	require.NoError(t, err)
	assert.Equal(t, serverID, server.ID)
	srvRepo.AssertNotCalled(t, "AddMember", mock.Anything, mock.Anything)
	inviteRepo.AssertNotCalled(t, "IncrementUses", mock.Anything)
}

func TestJoinViaInvite_Owner_NoOp(t *testing.T) {
	serverID, ownerID, code := uuid.New(), uuid.New(), "abc123"

	inviteRepo := new(MockInviteRepository)
	inviteRepo.On("GetByCode", code).Return(&domain.Invite{Code: code, ServerID: serverID}, nil)

	srvRepo := new(MockServerRepository)
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID}, nil)

	uc := usecase.NewInviteUseCase(inviteRepo, srvRepo, new(MockPermissionUseCase))
	server, err := uc.JoinViaInvite(code, ownerID)

	require.NoError(t, err)
	assert.Equal(t, serverID, server.ID)
	srvRepo.AssertNotCalled(t, "IsMember", mock.Anything, mock.Anything)
	srvRepo.AssertNotCalled(t, "AddMember", mock.Anything, mock.Anything)
}

func TestJoinViaInvite_UnknownCode_NotFound(t *testing.T) {
	userID, code := uuid.New(), "nope"

	inviteRepo := new(MockInviteRepository)
	inviteRepo.On("GetByCode", code).Return(nil, fmt.Errorf("invite %s: %w", code, domain.ErrInviteNotFound))

	uc := usecase.NewInviteUseCase(inviteRepo, new(MockServerRepository), new(MockPermissionUseCase))
	server, err := uc.JoinViaInvite(code, userID)

	assert.Nil(t, server)
	assert.ErrorIs(t, err, domain.ErrInviteNotFound)
}
