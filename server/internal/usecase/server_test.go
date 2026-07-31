package usecase_test

import (
	"fmt"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"

	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/internal/usecase"
)

// permsOwner — актор является владельцем сервера.
func permsOwner(serverID, userID uuid.UUID) *MockPermissionUseCase {
	p := new(MockPermissionUseCase)
	p.On("Resolve", serverID, userID).Return(domain.PermissionSet{IsOwner: true, HighestPosition: 0}, nil)
	return p
}

// permsWith — актор с конкретным набором битов и позицией 0.
func permsWith(serverID, userID uuid.UUID, bits domain.Permission) *MockPermissionUseCase {
	p := new(MockPermissionUseCase)
	p.On("Resolve", serverID, userID).Return(domain.PermissionSet{Bits: bits, HighestPosition: 0}, nil)
	return p
}

func TestCreateServer_AddsOwnerAsMember(t *testing.T) {
	ownerID := uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	roleRepo := new(MockRoleRepository)

	usrRepo.On("GetByID", ownerID).Return(&domain.User{ID: ownerID}, nil)
	srvRepo.On("Create", mock.AnythingOfType("*domain.Server")).Return(nil)
	srvRepo.On("AddMember", mock.AnythingOfType("uuid.UUID"), ownerID).Return(nil)
	roleRepo.On("Create", mock.AnythingOfType("*domain.Role")).Return(nil)
	chRepo.On("Create", mock.AnythingOfType("*domain.Channel")).Return(nil)

	perms := new(MockPermissionUseCase)
	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, roleRepo, new(MockStorage), perms)
	got, err := uc.CreateServer("Мой сервер", ownerID)

	require.NoError(t, err)
	srvRepo.AssertCalled(t, "AddMember", got.ID, ownerID)

	roleRepo.AssertCalled(t, "Create", mock.MatchedBy(func(role *domain.Role) bool {
		return role.ServerID == got.ID &&
			role.IsDefault &&
			role.Position == 0 &&
			role.Permissions == (domain.PermViewChannels|domain.PermSendMessages)
	}))
}

func TestCreateServer_DefaultRoleCreationFails_ReturnsError(t *testing.T) {
	ownerID := uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	roleRepo := new(MockRoleRepository)

	usrRepo.On("GetByID", ownerID).Return(&domain.User{ID: ownerID}, nil)
	srvRepo.On("Create", mock.AnythingOfType("*domain.Server")).Return(nil)
	srvRepo.On("AddMember", mock.AnythingOfType("uuid.UUID"), ownerID).Return(nil)
	roleRepo.On("Create", mock.AnythingOfType("*domain.Role")).Return(fmt.Errorf("db down"))
	wantErr := fmt.Errorf("db down")
	srvRepo.On("Delete", mock.AnythingOfType("uuid.UUID")).Return(nil)

	perms := new(MockPermissionUseCase)
	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, roleRepo, new(MockStorage), perms)
	got, err := uc.CreateServer("Мой сервер", ownerID)

	assert.Nil(t, got)
	require.Error(t, err)
	assert.ErrorContains(t, err, wantErr.Error())
	chRepo.AssertNotCalled(t, "Create", mock.Anything)
}

// TestCreateServer_DefaultRoleCreationFails_CompensatesByDeletingServer —
// если создание роли @everyone падает уже после успешного serverRepo.Create,
// сервер остался бы в БД без дефолтной роли — неремонтируемое состояние
// (участники получают 403 навсегда, UI управления ролями не сделан). Юзкейс
// обязан удалить только что созданный сервер компенсирующим вызовом.
func TestCreateServer_DefaultRoleCreationFails_CompensatesByDeletingServer(t *testing.T) {
	ownerID := uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	roleRepo := new(MockRoleRepository)

	usrRepo.On("GetByID", ownerID).Return(&domain.User{ID: ownerID}, nil)
	srvRepo.On("Create", mock.AnythingOfType("*domain.Server")).Return(nil)
	srvRepo.On("AddMember", mock.AnythingOfType("uuid.UUID"), ownerID).Return(nil)
	roleRepo.On("Create", mock.AnythingOfType("*domain.Role")).Return(fmt.Errorf("db down"))
	srvRepo.On("Delete", mock.AnythingOfType("uuid.UUID")).Return(nil)

	perms := new(MockPermissionUseCase)
	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, roleRepo, new(MockStorage), perms)
	got, err := uc.CreateServer("Мой сервер", ownerID)

	require.Error(t, err)
	assert.Nil(t, got)

	// Идентификатор созданного сервера был передан в Delete — берём его из
	// аргумента Create, так как got == nil после ошибки.
	require.Len(t, srvRepo.Calls, 3, "Create, AddMember, Delete")
	createdServer := srvRepo.Calls[0].Arguments.Get(0).(*domain.Server)
	srvRepo.AssertCalled(t, "Delete", createdServer.ID)
}

// TestCreateServer_AddMemberFails_CompensatesByDeletingServer — то же самое,
// но ошибка возникает на шаге AddMember: без владельца в server_members
// сервер тоже неремонтируем (member_roles ссылается на эту строку по FK).
func TestCreateServer_AddMemberFails_CompensatesByDeletingServer(t *testing.T) {
	ownerID := uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	roleRepo := new(MockRoleRepository)

	usrRepo.On("GetByID", ownerID).Return(&domain.User{ID: ownerID}, nil)
	srvRepo.On("Create", mock.AnythingOfType("*domain.Server")).Return(nil)
	srvRepo.On("AddMember", mock.AnythingOfType("uuid.UUID"), ownerID).Return(fmt.Errorf("db down"))
	srvRepo.On("Delete", mock.AnythingOfType("uuid.UUID")).Return(nil)

	perms := new(MockPermissionUseCase)
	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, roleRepo, new(MockStorage), perms)
	got, err := uc.CreateServer("Мой сервер", ownerID)

	require.Error(t, err)
	assert.Nil(t, got)
	roleRepo.AssertNotCalled(t, "Create", mock.Anything)

	require.Len(t, srvRepo.Calls, 3, "Create, AddMember, Delete")
	createdServer := srvRepo.Calls[0].Arguments.Get(0).(*domain.Server)
	srvRepo.AssertCalled(t, "Delete", createdServer.ID)
}

func TestGetMembers_Owner_Success(t *testing.T) {
	serverID, ownerID := uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	storage := new(MockStorage)
	perms := permsOwner(serverID, ownerID)

	want := []*domain.MemberWithUser{{UserID: ownerID, Username: "owner", Roles: []uuid.UUID{}}}
	srvRepo.On("GetMembersWithUsers", serverID).Return(want, nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, new(MockRoleRepository), storage, perms)
	got, err := uc.GetMembers(serverID, ownerID)

	assert.NoError(t, err)
	assert.Equal(t, want, got)
	srvRepo.AssertNotCalled(t, "IsMember", mock.Anything, mock.Anything)
}

func TestGetMembers_Member_Success(t *testing.T) {
	serverID, userID := uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	storage := new(MockStorage)
	perms := permsWith(serverID, userID, domain.PermViewChannels)

	want := []*domain.MemberWithUser{{UserID: userID, Username: "member", Roles: []uuid.UUID{}}}
	srvRepo.On("GetMembersWithUsers", serverID).Return(want, nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, new(MockRoleRepository), storage, perms)
	got, err := uc.GetMembers(serverID, userID)

	assert.NoError(t, err)
	assert.Equal(t, want, got)
}

func TestGetMembers_NoViewPermission_Forbidden(t *testing.T) {
	serverID, userID := uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	perms := permsWith(serverID, userID, 0)

	uc := usecase.NewServerUseCase(srvRepo, new(MockChannelRepository), new(MockUserRepository), new(MockRoleRepository), new(MockStorage), perms)
	got, err := uc.GetMembers(serverID, userID)

	assert.Nil(t, got)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	srvRepo.AssertNotCalled(t, "GetMembersWithUsers", mock.Anything)
}

func TestUpdateServer_Owner_Success(t *testing.T) {
	serverID, ownerID := uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	storage := new(MockStorage)
	perms := permsOwner(serverID, ownerID)

	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID, Name: "old"}, nil)
	srvRepo.On("Update", serverID, map[string]interface{}{"name": "new"}).Return(nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, new(MockRoleRepository), storage, perms)
	got, err := uc.UpdateServer(serverID, ownerID, "new")

	assert.NoError(t, err)
	assert.Equal(t, "new", got.Name)
	srvRepo.AssertCalled(t, "Update", serverID, map[string]interface{}{"name": "new"})
}

func TestUpdateServer_NoManageServerPermission_Forbidden(t *testing.T) {
	serverID, userID := uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	storage := new(MockStorage)
	perms := permsWith(serverID, userID, 0)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, new(MockRoleRepository), storage, perms)
	got, err := uc.UpdateServer(serverID, userID, "new")

	assert.Nil(t, got)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	srvRepo.AssertNotCalled(t, "Update", mock.Anything, mock.Anything)
}

func TestUpdateServer_ServerNotFound(t *testing.T) {
	serverID, userID := uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	storage := new(MockStorage)
	perms := permsOwner(serverID, userID)

	srvRepo.On("GetByID", serverID).Return(nil, fmt.Errorf("server not found"))

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, new(MockRoleRepository), storage, perms)
	got, err := uc.UpdateServer(serverID, userID, "new")

	assert.Nil(t, got)
	assert.ErrorIs(t, err, domain.ErrServerNotFound)
}

func TestDeleteServer_Owner_Success(t *testing.T) {
	serverID, ownerID := uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	storage := new(MockStorage)
	perms := new(MockPermissionUseCase)

	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID}, nil)
	srvRepo.On("Delete", serverID).Return(nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, new(MockRoleRepository), storage, perms)
	err := uc.DeleteServer(serverID, ownerID)

	assert.NoError(t, err)
	srvRepo.AssertCalled(t, "Delete", serverID)
}

func TestDeleteServer_NotOwner_Forbidden(t *testing.T) {
	serverID, ownerID, userID := uuid.New(), uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	storage := new(MockStorage)
	perms := new(MockPermissionUseCase)

	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID}, nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, new(MockRoleRepository), storage, perms)
	err := uc.DeleteServer(serverID, userID)

	assert.ErrorIs(t, err, domain.ErrForbidden)
	srvRepo.AssertNotCalled(t, "Delete", mock.Anything)
}

func TestUpdateChannel_Owner_Success(t *testing.T) {
	serverID, ownerID, channelID := uuid.New(), uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	storage := new(MockStorage)
	perms := permsOwner(serverID, ownerID)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID, Name: "old"}, nil)
	chRepo.On("Update", channelID, map[string]interface{}{"name": "new"}).Return(nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, new(MockRoleRepository), storage, perms)
	got, err := uc.UpdateChannel(serverID, channelID, ownerID, "new")

	assert.NoError(t, err)
	assert.Equal(t, "new", got.Name)
}

func TestUpdateChannel_NoManageChannelsPermission_Forbidden(t *testing.T) {
	serverID, userID, channelID := uuid.New(), uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	storage := new(MockStorage)
	perms := permsWith(serverID, userID, 0)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, new(MockRoleRepository), storage, perms)
	got, err := uc.UpdateChannel(serverID, channelID, userID, "new")

	assert.Nil(t, got)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	chRepo.AssertNotCalled(t, "GetByID", mock.Anything)
}

func TestUpdateChannel_WrongServer_NotFound(t *testing.T) {
	serverID, otherServerID, ownerID, channelID := uuid.New(), uuid.New(), uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	storage := new(MockStorage)
	perms := permsOwner(serverID, ownerID)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: otherServerID}, nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, new(MockRoleRepository), storage, perms)
	got, err := uc.UpdateChannel(serverID, channelID, ownerID, "new")

	assert.Nil(t, got)
	assert.ErrorIs(t, err, domain.ErrChannelNotFound)
	chRepo.AssertNotCalled(t, "Update", mock.Anything, mock.Anything)
}

func TestDeleteChannel_Owner_MultipleChannels_Success(t *testing.T) {
	serverID, ownerID, channelID := uuid.New(), uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	storage := new(MockStorage)
	perms := permsOwner(serverID, ownerID)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	chRepo.On("DeleteIfNotLast", channelID, serverID).Return(true, nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, new(MockRoleRepository), storage, perms)
	err := uc.DeleteChannel(serverID, channelID, ownerID)

	assert.NoError(t, err)
	chRepo.AssertCalled(t, "DeleteIfNotLast", channelID, serverID)
}

func TestDeleteChannel_LastChannel_Rejected(t *testing.T) {
	serverID, ownerID, channelID := uuid.New(), uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	storage := new(MockStorage)
	perms := permsOwner(serverID, ownerID)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	chRepo.On("DeleteIfNotLast", channelID, serverID).Return(false, nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, new(MockRoleRepository), storage, perms)
	err := uc.DeleteChannel(serverID, channelID, ownerID)

	assert.ErrorIs(t, err, domain.ErrLastChannel)
	chRepo.AssertNotCalled(t, "Delete", mock.Anything)
}

func TestDeleteChannel_NoManageChannelsPermission_Forbidden(t *testing.T) {
	serverID, userID, channelID := uuid.New(), uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	storage := new(MockStorage)
	perms := permsWith(serverID, userID, 0)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, new(MockRoleRepository), storage, perms)
	err := uc.DeleteChannel(serverID, channelID, userID)

	assert.ErrorIs(t, err, domain.ErrForbidden)
	chRepo.AssertNotCalled(t, "GetByID", mock.Anything)
}

func TestUpdateServerIcon_Owner_SavesAndUpdatesURL(t *testing.T) {
	serverID, ownerID := uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	storage := new(MockStorage)
	perms := permsOwner(serverID, ownerID)

	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID}, nil)
	storage.On("Save", mock.Anything, mock.MatchedBy(func(key string) bool {
		return strings.HasPrefix(key, "server-icons/"+serverID.String()+"/") && strings.HasSuffix(key, ".png")
	}), mock.Anything, "image/png").Return("/uploads/server-icons/x/y.png", nil)
	srvRepo.On("Update", serverID, map[string]interface{}{"icon_url": "/uploads/server-icons/x/y.png"}).Return(nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, new(MockRoleRepository), storage, perms)
	got, err := uc.UpdateServerIcon(serverID, ownerID, fakePNGBytes(64, 64))

	require.NoError(t, err)
	require.NotNil(t, got.IconURL)
	assert.Equal(t, "/uploads/server-icons/x/y.png", *got.IconURL)
}

func TestUpdateServerIcon_NoManageServerPermission_Forbidden(t *testing.T) {
	serverID, userID := uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	storage := new(MockStorage)
	perms := permsWith(serverID, userID, 0)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, new(MockRoleRepository), storage, perms)
	got, err := uc.UpdateServerIcon(serverID, userID, fakePNGBytes(64, 64))

	assert.Nil(t, got)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	storage.AssertNotCalled(t, "Save", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func TestUpdateServerIcon_RejectsUnsupportedFormat(t *testing.T) {
	serverID, ownerID := uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	storage := new(MockStorage)
	perms := permsOwner(serverID, ownerID)

	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID}, nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, new(MockRoleRepository), storage, perms)
	got, err := uc.UpdateServerIcon(serverID, ownerID, []byte("not an image, just plain text bytes"))

	assert.Nil(t, got)
	assert.ErrorIs(t, err, domain.ErrUnsupportedAvatarFormat)
}

func TestRemoveServerIcon_Owner_ClearsURLAndDeletesFile(t *testing.T) {
	serverID, ownerID := uuid.New(), uuid.New()
	oldURL := "/uploads/server-icons/old.png"

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	storage := new(MockStorage)
	perms := permsOwner(serverID, ownerID)

	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID, IconURL: &oldURL}, nil)
	srvRepo.On("Update", serverID, map[string]interface{}{"icon_url": nil}).Return(nil)
	storage.On("Delete", mock.Anything, oldURL).Return(nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, new(MockRoleRepository), storage, perms)
	got, err := uc.RemoveServerIcon(serverID, ownerID)

	require.NoError(t, err)
	assert.Nil(t, got.IconURL)
	storage.AssertExpectations(t)
}

func TestRemoveServerIcon_NoOpWhenNoIconSet(t *testing.T) {
	serverID, ownerID := uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	storage := new(MockStorage)
	perms := permsOwner(serverID, ownerID)

	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID}, nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, new(MockRoleRepository), storage, perms)
	got, err := uc.RemoveServerIcon(serverID, ownerID)

	require.NoError(t, err)
	assert.Nil(t, got.IconURL)
	srvRepo.AssertNotCalled(t, "Update", mock.Anything, mock.Anything)
	storage.AssertNotCalled(t, "Delete", mock.Anything, mock.Anything)
}

func TestRemoveServerIcon_NoManageServerPermission_Forbidden(t *testing.T) {
	serverID, userID := uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	storage := new(MockStorage)
	perms := permsWith(serverID, userID, 0)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, new(MockRoleRepository), storage, perms)
	got, err := uc.RemoveServerIcon(serverID, userID)

	assert.Nil(t, got)
	assert.ErrorIs(t, err, domain.ErrForbidden)
}

func TestCreateChannel_WithoutManageChannels_Forbidden(t *testing.T) {
	serverID, userID := uuid.New(), uuid.New()

	chRepo := new(MockChannelRepository)
	perms := permsWith(serverID, userID, domain.PermViewChannels|domain.PermSendMessages)

	uc := usecase.NewServerUseCase(new(MockServerRepository), chRepo, new(MockUserRepository), new(MockRoleRepository), new(MockStorage), perms)
	got, err := uc.CreateChannel(serverID, userID, "новый", domain.ChannelTypeText)

	assert.Nil(t, got)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	chRepo.AssertNotCalled(t, "Create", mock.Anything)
}

func TestCreateChannel_WithManageChannels_Success(t *testing.T) {
	serverID, userID := uuid.New(), uuid.New()

	chRepo := new(MockChannelRepository)
	chRepo.On("GetByServerID", serverID).Return([]*domain.Channel{}, nil)
	chRepo.On("Create", mock.AnythingOfType("*domain.Channel")).Return(nil)
	perms := permsWith(serverID, userID, domain.PermManageChannels)

	uc := usecase.NewServerUseCase(new(MockServerRepository), chRepo, new(MockUserRepository), new(MockRoleRepository), new(MockStorage), perms)
	got, err := uc.CreateChannel(serverID, userID, "новый", domain.ChannelTypeText)

	require.NoError(t, err)
	assert.Equal(t, "новый", got.Name)
}

func TestGetChannels_WithoutViewPermission_Forbidden(t *testing.T) {
	serverID, userID := uuid.New(), uuid.New()

	chRepo := new(MockChannelRepository)
	perms := permsWith(serverID, userID, 0)

	uc := usecase.NewServerUseCase(new(MockServerRepository), chRepo, new(MockUserRepository), new(MockRoleRepository), new(MockStorage), perms)
	got, err := uc.GetChannels(serverID, userID)

	assert.Nil(t, got)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	chRepo.AssertNotCalled(t, "GetByServerID", mock.Anything)
}
