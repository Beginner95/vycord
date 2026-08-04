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

func TestCreateServer_NameTaken_ReturnsErr(t *testing.T) {
	ownerID := uuid.New()

	srvRepo := new(MockServerRepository)
	usrRepo := new(MockUserRepository)

	usrRepo.On("GetByID", ownerID).Return(&domain.User{ID: ownerID}, nil)
	srvRepo.On("GetByName", "Webvaha").Return(&domain.Server{ID: uuid.New(), Name: "Webvaha"}, nil)

	perms := new(MockPermissionUseCase)
	uc := usecase.NewServerUseCase(srvRepo, new(MockChannelRepository), usrRepo, new(MockRoleRepository), new(MockStorage), perms)
	got, err := uc.CreateServer("Webvaha", ownerID)

	assert.Nil(t, got)
	assert.ErrorIs(t, err, domain.ErrServerNameTaken)
	srvRepo.AssertNotCalled(t, "Create", mock.Anything)
}

func TestCreateServer_AddsOwnerAsMember(t *testing.T) {
	ownerID := uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	roleRepo := new(MockRoleRepository)

	usrRepo.On("GetByID", ownerID).Return(&domain.User{ID: ownerID}, nil)
	srvRepo.On("GetByName", "Мой сервер").Return(nil, domain.ErrServerNotFound)
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
	srvRepo.On("GetByName", "Мой сервер").Return(nil, domain.ErrServerNotFound)
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
	srvRepo.On("GetByName", "Мой сервер").Return(nil, domain.ErrServerNotFound)
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
	require.Len(t, srvRepo.Calls, 4, "GetByName, Create, AddMember, Delete")
	createdServer := srvRepo.Calls[1].Arguments.Get(0).(*domain.Server)
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
	srvRepo.On("GetByName", "Мой сервер").Return(nil, domain.ErrServerNotFound)
	srvRepo.On("Create", mock.AnythingOfType("*domain.Server")).Return(nil)
	srvRepo.On("AddMember", mock.AnythingOfType("uuid.UUID"), ownerID).Return(fmt.Errorf("db down"))
	srvRepo.On("Delete", mock.AnythingOfType("uuid.UUID")).Return(nil)

	perms := new(MockPermissionUseCase)
	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, roleRepo, new(MockStorage), perms)
	got, err := uc.CreateServer("Мой сервер", ownerID)

	require.Error(t, err)
	assert.Nil(t, got)
	roleRepo.AssertNotCalled(t, "Create", mock.Anything)

	require.Len(t, srvRepo.Calls, 4, "GetByName, Create, AddMember, Delete")
	createdServer := srvRepo.Calls[1].Arguments.Get(0).(*domain.Server)
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
	srvRepo.On("GetByName", "new").Return(nil, domain.ErrServerNotFound)
	srvRepo.On("Update", serverID, map[string]interface{}{"name": "new"}).Return(nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, new(MockRoleRepository), storage, perms)
	got, err := uc.UpdateServer(serverID, ownerID, "new")

	assert.NoError(t, err)
	assert.Equal(t, "new", got.Name)
	srvRepo.AssertCalled(t, "Update", serverID, map[string]interface{}{"name": "new"})
}

func TestUpdateServer_NameTaken_ReturnsErr(t *testing.T) {
	serverID, ownerID := uuid.New(), uuid.New()
	takenID := uuid.New()

	srvRepo := new(MockServerRepository)
	perms := permsOwner(serverID, ownerID)

	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID, Name: "old"}, nil)
	srvRepo.On("GetByName", "Webvaha").Return(&domain.Server{ID: takenID, Name: "Webvaha"}, nil)

	uc := usecase.NewServerUseCase(srvRepo, new(MockChannelRepository), new(MockUserRepository), new(MockRoleRepository), new(MockStorage), perms)
	got, err := uc.UpdateServer(serverID, ownerID, "Webvaha")

	assert.Nil(t, got)
	assert.ErrorIs(t, err, domain.ErrServerNameTaken)
	srvRepo.AssertNotCalled(t, "Update", mock.Anything, mock.Anything)
}

func TestUpdateServer_RenameToOwnNameDifferentCase_Success(t *testing.T) {
	serverID, ownerID := uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	perms := permsOwner(serverID, ownerID)

	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID, Name: "Webvaha"}, nil)
	srvRepo.On("GetByName", "webvaha").Return(&domain.Server{ID: serverID, Name: "webvaha"}, nil)
	srvRepo.On("Update", serverID, map[string]interface{}{"name": "webvaha"}).Return(nil)

	uc := usecase.NewServerUseCase(srvRepo, new(MockChannelRepository), new(MockUserRepository), new(MockRoleRepository), new(MockStorage), perms)
	got, err := uc.UpdateServer(serverID, ownerID, "webvaha")

	assert.NoError(t, err)
	assert.Equal(t, "webvaha", got.Name)
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
	chRepo.On("Update", channelID, map[string]interface{}{"name": "new", "is_private": false}).Return(nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, new(MockRoleRepository), storage, perms)
	got, err := uc.UpdateChannel(serverID, channelID, ownerID, "new", false)

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
	got, err := uc.UpdateChannel(serverID, channelID, userID, "new", false)

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
	got, err := uc.UpdateChannel(serverID, channelID, ownerID, "new", false)

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
	got, err := uc.CreateChannel(serverID, userID, "новый", domain.ChannelTypeText, false)

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
	got, err := uc.CreateChannel(serverID, userID, "новый", domain.ChannelTypeText, false)

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

func TestCreateChannel_Private_AddsOwnerAsMember(t *testing.T) {
	serverID := uuid.New()
	userID := uuid.New()

	chRepo := new(MockChannelRepository)
	chRepo.On("GetByServerID", serverID).Return([]*domain.Channel{}, nil)
	chRepo.On("Create", mock.AnythingOfType("*domain.Channel")).Return(nil)
	chRepo.On("AddMember", mock.AnythingOfType("uuid.UUID"), userID, userID).Return(nil)

	perms := permsWith(serverID, userID, domain.PermManageChannels)
	uc := usecase.NewServerUseCase(new(MockServerRepository), chRepo, new(MockUserRepository), new(MockRoleRepository), new(MockStorage), perms)

	ch, err := uc.CreateChannel(serverID, userID, "secret", domain.ChannelTypeText, true)

	require.NoError(t, err)
	assert.True(t, ch.IsPrivate)
	assert.Equal(t, userID, ch.OwnerID)
	chRepo.AssertCalled(t, "AddMember", ch.ID, userID, userID)
}

func TestCreateChannel_Public_DoesNotAddMember(t *testing.T) {
	serverID := uuid.New()
	userID := uuid.New()

	chRepo := new(MockChannelRepository)
	chRepo.On("GetByServerID", serverID).Return([]*domain.Channel{}, nil)
	chRepo.On("Create", mock.AnythingOfType("*domain.Channel")).Return(nil)

	perms := permsWith(serverID, userID, domain.PermManageChannels)
	uc := usecase.NewServerUseCase(new(MockServerRepository), chRepo, new(MockUserRepository), new(MockRoleRepository), new(MockStorage), perms)

	_, err := uc.CreateChannel(serverID, userID, "general", domain.ChannelTypeText, false)

	require.NoError(t, err)
	chRepo.AssertNotCalled(t, "AddMember", mock.Anything, mock.Anything, mock.Anything)
}

func TestGetChannels_HidesPrivateChannelFromOutsider(t *testing.T) {
	serverID := uuid.New()
	ownerID := uuid.New()
	outsiderID := uuid.New()

	publicCh := &domain.Channel{ID: uuid.New(), ServerID: serverID, IsPrivate: false}
	privateCh := &domain.Channel{ID: uuid.New(), ServerID: serverID, IsPrivate: true, OwnerID: ownerID}

	chRepo := new(MockChannelRepository)
	chRepo.On("GetByServerID", serverID).Return([]*domain.Channel{publicCh, privateCh}, nil)
	chRepo.On("IsMember", privateCh.ID, outsiderID).Return(false, nil)

	perms := permsWith(serverID, outsiderID, domain.PermViewChannels)
	uc := usecase.NewServerUseCase(new(MockServerRepository), chRepo, new(MockUserRepository), new(MockRoleRepository), new(MockStorage), perms)

	got, err := uc.GetChannels(serverID, outsiderID)

	require.NoError(t, err)
	require.Len(t, got, 1)
	assert.Equal(t, publicCh.ID, got[0].ID)
}

func TestGetChannels_ShowsPrivateChannelToInvitedMember(t *testing.T) {
	serverID := uuid.New()
	ownerID := uuid.New()
	memberID := uuid.New()

	privateCh := &domain.Channel{ID: uuid.New(), ServerID: serverID, IsPrivate: true, OwnerID: ownerID}

	chRepo := new(MockChannelRepository)
	chRepo.On("GetByServerID", serverID).Return([]*domain.Channel{privateCh}, nil)
	chRepo.On("IsMember", privateCh.ID, memberID).Return(true, nil)

	perms := permsWith(serverID, memberID, domain.PermViewChannels)
	uc := usecase.NewServerUseCase(new(MockServerRepository), chRepo, new(MockUserRepository), new(MockRoleRepository), new(MockStorage), perms)

	got, err := uc.GetChannels(serverID, memberID)

	require.NoError(t, err)
	require.Len(t, got, 1)
}

func TestGetChannels_OwnerSeesOwnPrivateChannelWithoutMembershipLookup(t *testing.T) {
	serverID := uuid.New()
	ownerID := uuid.New()

	privateCh := &domain.Channel{ID: uuid.New(), ServerID: serverID, IsPrivate: true, OwnerID: ownerID}

	chRepo := new(MockChannelRepository)
	chRepo.On("GetByServerID", serverID).Return([]*domain.Channel{privateCh}, nil)

	perms := permsWith(serverID, ownerID, domain.PermViewChannels)
	uc := usecase.NewServerUseCase(new(MockServerRepository), chRepo, new(MockUserRepository), new(MockRoleRepository), new(MockStorage), perms)

	got, err := uc.GetChannels(serverID, ownerID)

	require.NoError(t, err)
	require.Len(t, got, 1)
	chRepo.AssertNotCalled(t, "IsMember", mock.Anything, mock.Anything)
}

func TestUpdateChannel_TogglePublicToPrivate_AddsOwnerAsMember(t *testing.T) {
	serverID := uuid.New()
	ownerID := uuid.New()
	channelID := uuid.New()

	ch := &domain.Channel{ID: channelID, ServerID: serverID, Name: "general", IsPrivate: false, OwnerID: ownerID}

	chRepo := new(MockChannelRepository)
	chRepo.On("GetByID", channelID).Return(ch, nil)
	chRepo.On("Update", channelID, map[string]interface{}{"name": "general", "is_private": true}).Return(nil)
	chRepo.On("AddMember", channelID, ownerID, ownerID).Return(nil)

	perms := permsWith(serverID, ownerID, domain.PermManageChannels)
	uc := usecase.NewServerUseCase(new(MockServerRepository), chRepo, new(MockUserRepository), new(MockRoleRepository), new(MockStorage), perms)

	got, err := uc.UpdateChannel(serverID, channelID, ownerID, "general", true)

	require.NoError(t, err)
	assert.True(t, got.IsPrivate)
	chRepo.AssertCalled(t, "AddMember", channelID, ownerID, ownerID)
}

func TestUpdateChannel_TogglePrivateToPublic_ClearsMembers(t *testing.T) {
	serverID := uuid.New()
	ownerID := uuid.New()
	channelID := uuid.New()

	ch := &domain.Channel{ID: channelID, ServerID: serverID, Name: "secret", IsPrivate: true, OwnerID: ownerID}

	chRepo := new(MockChannelRepository)
	chRepo.On("GetByID", channelID).Return(ch, nil)
	chRepo.On("Update", channelID, map[string]interface{}{"name": "secret", "is_private": false}).Return(nil)
	chRepo.On("RemoveAllMembers", channelID).Return(nil)

	perms := permsWith(serverID, ownerID, domain.PermManageChannels)
	uc := usecase.NewServerUseCase(new(MockServerRepository), chRepo, new(MockUserRepository), new(MockRoleRepository), new(MockStorage), perms)

	got, err := uc.UpdateChannel(serverID, channelID, ownerID, "secret", false)

	require.NoError(t, err)
	assert.False(t, got.IsPrivate)
	chRepo.AssertCalled(t, "RemoveAllMembers", channelID)
}

func TestUpdateChannel_PrivacyChangeByNonOwnerNonAdmin_Forbidden(t *testing.T) {
	serverID := uuid.New()
	ownerID := uuid.New()
	otherID := uuid.New()
	channelID := uuid.New()

	ch := &domain.Channel{ID: channelID, ServerID: serverID, Name: "general", IsPrivate: false, OwnerID: ownerID}

	chRepo := new(MockChannelRepository)
	chRepo.On("GetByID", channelID).Return(ch, nil)

	// otherID has MANAGE_CHANNELS but is neither the channel owner, the
	// server owner, nor an administrator — must not be able to flip privacy.
	perms := permsWith(serverID, otherID, domain.PermManageChannels)
	uc := usecase.NewServerUseCase(new(MockServerRepository), chRepo, new(MockUserRepository), new(MockRoleRepository), new(MockStorage), perms)

	_, err := uc.UpdateChannel(serverID, channelID, otherID, "general", true)

	assert.ErrorIs(t, err, domain.ErrChannelForbidden)
	chRepo.AssertNotCalled(t, "Update", mock.Anything, mock.Anything)
}

func TestUpdateChannel_RenameOnly_DoesNotTouchMembers(t *testing.T) {
	serverID := uuid.New()
	ownerID := uuid.New()
	channelID := uuid.New()

	ch := &domain.Channel{ID: channelID, ServerID: serverID, Name: "general", IsPrivate: false, OwnerID: ownerID}

	chRepo := new(MockChannelRepository)
	chRepo.On("GetByID", channelID).Return(ch, nil)
	chRepo.On("Update", channelID, map[string]interface{}{"name": "renamed", "is_private": false}).Return(nil)

	// Renaming only needs MANAGE_CHANNELS — the caller here isn't the channel
	// owner, and that's fine because is_private isn't changing.
	renamerID := uuid.New()
	perms := permsWith(serverID, renamerID, domain.PermManageChannels)
	uc := usecase.NewServerUseCase(new(MockServerRepository), chRepo, new(MockUserRepository), new(MockRoleRepository), new(MockStorage), perms)

	_, err := uc.UpdateChannel(serverID, channelID, renamerID, "renamed", false)

	require.NoError(t, err)
	chRepo.AssertNotCalled(t, "AddMember", mock.Anything, mock.Anything, mock.Anything)
	chRepo.AssertNotCalled(t, "RemoveAllMembers", mock.Anything)
}

func TestCheckChannelAccess_PublicChannel_MemberAllowed(t *testing.T) {
	serverID := uuid.New()
	userID := uuid.New()
	channelID := uuid.New()
	ch := &domain.Channel{ID: channelID, ServerID: serverID, IsPrivate: false}

	chRepo := new(MockChannelRepository)
	chRepo.On("GetByID", channelID).Return(ch, nil)

	perms := permsWith(serverID, userID, domain.PermViewChannels)
	uc := usecase.NewServerUseCase(new(MockServerRepository), chRepo, new(MockUserRepository), new(MockRoleRepository), new(MockStorage), perms)

	got, err := uc.CheckChannelAccess(channelID, userID)

	require.NoError(t, err)
	assert.Equal(t, channelID, got.ID)
}

func TestCheckChannelAccess_PublicChannel_NonMemberForbidden(t *testing.T) {
	serverID := uuid.New()
	userID := uuid.New()
	channelID := uuid.New()
	ch := &domain.Channel{ID: channelID, ServerID: serverID, IsPrivate: false}

	chRepo := new(MockChannelRepository)
	chRepo.On("GetByID", channelID).Return(ch, nil)

	perms := permsWith(serverID, userID, 0)
	uc := usecase.NewServerUseCase(new(MockServerRepository), chRepo, new(MockUserRepository), new(MockRoleRepository), new(MockStorage), perms)

	_, err := uc.CheckChannelAccess(channelID, userID)

	assert.ErrorIs(t, err, domain.ErrChannelForbidden)
}

func TestCheckChannelAccess_PrivateChannel_OutsiderForbidden(t *testing.T) {
	serverID := uuid.New()
	ownerID := uuid.New()
	outsiderID := uuid.New()
	channelID := uuid.New()
	ch := &domain.Channel{ID: channelID, ServerID: serverID, IsPrivate: true, OwnerID: ownerID}

	chRepo := new(MockChannelRepository)
	chRepo.On("GetByID", channelID).Return(ch, nil)
	chRepo.On("IsMember", channelID, outsiderID).Return(false, nil)

	perms := permsWith(serverID, outsiderID, domain.PermViewChannels)
	uc := usecase.NewServerUseCase(new(MockServerRepository), chRepo, new(MockUserRepository), new(MockRoleRepository), new(MockStorage), perms)

	_, err := uc.CheckChannelAccess(channelID, outsiderID)

	assert.ErrorIs(t, err, domain.ErrChannelForbidden)
}

func TestCheckChannelAccess_PrivateChannel_InvitedMemberAllowed(t *testing.T) {
	serverID := uuid.New()
	ownerID := uuid.New()
	memberID := uuid.New()
	channelID := uuid.New()
	ch := &domain.Channel{ID: channelID, ServerID: serverID, IsPrivate: true, OwnerID: ownerID}

	chRepo := new(MockChannelRepository)
	chRepo.On("GetByID", channelID).Return(ch, nil)
	chRepo.On("IsMember", channelID, memberID).Return(true, nil)

	perms := permsWith(serverID, memberID, domain.PermViewChannels)
	uc := usecase.NewServerUseCase(new(MockServerRepository), chRepo, new(MockUserRepository), new(MockRoleRepository), new(MockStorage), perms)

	got, err := uc.CheckChannelAccess(channelID, memberID)

	require.NoError(t, err)
	assert.Equal(t, channelID, got.ID)
}

func TestGetChannelAudience_PublicChannel_ReturnsNil(t *testing.T) {
	channelID := uuid.New()
	ch := &domain.Channel{ID: channelID, IsPrivate: false}

	chRepo := new(MockChannelRepository)
	chRepo.On("GetByID", channelID).Return(ch, nil)

	uc := usecase.NewServerUseCase(new(MockServerRepository), chRepo, new(MockUserRepository), new(MockRoleRepository), new(MockStorage), new(MockPermissionUseCase))

	got, err := uc.GetChannelAudience(channelID)

	require.NoError(t, err)
	assert.Nil(t, got)
}

func TestGetChannelAudience_PrivateChannel_IncludesOwnerServerOwnerAndMembers(t *testing.T) {
	serverID := uuid.New()
	serverOwnerID := uuid.New()
	channelOwnerID := uuid.New()
	invitedID := uuid.New()
	channelID := uuid.New()

	ch := &domain.Channel{ID: channelID, ServerID: serverID, IsPrivate: true, OwnerID: channelOwnerID}

	srvRepo := new(MockServerRepository)
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: serverOwnerID}, nil)
	srvRepo.On("GetMembersWithUsers", serverID).Return([]*domain.MemberWithUser{
		{UserID: serverOwnerID}, {UserID: channelOwnerID}, {UserID: invitedID},
	}, nil)

	chRepo := new(MockChannelRepository)
	chRepo.On("GetByID", channelID).Return(ch, nil)
	chRepo.On("GetMembersWithUsers", channelID).Return([]*domain.ChannelMemberWithUser{
		{UserID: invitedID},
	}, nil)

	perms := new(MockPermissionUseCase)
	perms.On("Resolve", serverID, serverOwnerID).Return(domain.PermissionSet{IsOwner: true}, nil)
	perms.On("Resolve", serverID, channelOwnerID).Return(domain.PermissionSet{}, nil)
	perms.On("Resolve", serverID, invitedID).Return(domain.PermissionSet{}, nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, new(MockUserRepository), new(MockRoleRepository), new(MockStorage), perms)

	got, err := uc.GetChannelAudience(channelID)

	require.NoError(t, err)
	assert.ElementsMatch(t, []uuid.UUID{serverOwnerID, channelOwnerID, invitedID}, got)
}

func TestInviteToChannel_OwnerInvitesServerMember_Success(t *testing.T) {
	serverID := uuid.New()
	ownerID := uuid.New()
	targetID := uuid.New()
	channelID := uuid.New()
	ch := &domain.Channel{ID: channelID, ServerID: serverID, IsPrivate: true, OwnerID: ownerID}

	chRepo := new(MockChannelRepository)
	chRepo.On("GetByID", channelID).Return(ch, nil)
	chRepo.On("AddMember", channelID, targetID, ownerID).Return(nil)

	srvRepo := new(MockServerRepository)
	srvRepo.On("IsMember", serverID, targetID).Return(true, nil)

	perms := permsWith(serverID, ownerID, 0)
	uc := usecase.NewServerUseCase(srvRepo, chRepo, new(MockUserRepository), new(MockRoleRepository), new(MockStorage), perms)

	err := uc.InviteToChannel(serverID, channelID, ownerID, targetID)

	require.NoError(t, err)
	chRepo.AssertCalled(t, "AddMember", channelID, targetID, ownerID)
}

func TestInviteToChannel_NonManagerForbidden(t *testing.T) {
	serverID := uuid.New()
	ownerID := uuid.New()
	otherID := uuid.New()
	targetID := uuid.New()
	channelID := uuid.New()
	ch := &domain.Channel{ID: channelID, ServerID: serverID, IsPrivate: true, OwnerID: ownerID}

	chRepo := new(MockChannelRepository)
	chRepo.On("GetByID", channelID).Return(ch, nil)

	// otherID has MANAGE_CHANNELS but isn't the channel owner/server owner/admin.
	perms := permsWith(serverID, otherID, domain.PermManageChannels)
	uc := usecase.NewServerUseCase(new(MockServerRepository), chRepo, new(MockUserRepository), new(MockRoleRepository), new(MockStorage), perms)

	err := uc.InviteToChannel(serverID, channelID, otherID, targetID)

	assert.ErrorIs(t, err, domain.ErrChannelForbidden)
	chRepo.AssertNotCalled(t, "AddMember", mock.Anything, mock.Anything, mock.Anything)
}

func TestInviteToChannel_TargetNotServerMember_Rejected(t *testing.T) {
	serverID := uuid.New()
	ownerID := uuid.New()
	targetID := uuid.New()
	channelID := uuid.New()
	ch := &domain.Channel{ID: channelID, ServerID: serverID, IsPrivate: true, OwnerID: ownerID}

	chRepo := new(MockChannelRepository)
	chRepo.On("GetByID", channelID).Return(ch, nil)

	srvRepo := new(MockServerRepository)
	srvRepo.On("IsMember", serverID, targetID).Return(false, nil)

	perms := permsWith(serverID, ownerID, 0)
	uc := usecase.NewServerUseCase(srvRepo, chRepo, new(MockUserRepository), new(MockRoleRepository), new(MockStorage), perms)

	err := uc.InviteToChannel(serverID, channelID, ownerID, targetID)

	assert.ErrorIs(t, err, domain.ErrTargetNotServerMember)
	chRepo.AssertNotCalled(t, "AddMember", mock.Anything, mock.Anything, mock.Anything)
}

func TestInviteToChannel_PublicChannel_Rejected(t *testing.T) {
	serverID := uuid.New()
	ownerID := uuid.New()
	targetID := uuid.New()
	channelID := uuid.New()
	ch := &domain.Channel{ID: channelID, ServerID: serverID, IsPrivate: false, OwnerID: ownerID}

	chRepo := new(MockChannelRepository)
	chRepo.On("GetByID", channelID).Return(ch, nil)

	perms := permsWith(serverID, ownerID, 0)
	uc := usecase.NewServerUseCase(new(MockServerRepository), chRepo, new(MockUserRepository), new(MockRoleRepository), new(MockStorage), perms)

	err := uc.InviteToChannel(serverID, channelID, ownerID, targetID)

	assert.ErrorIs(t, err, domain.ErrChannelNotPrivate)
}

func TestRemoveFromChannel_CannotRemoveOwner(t *testing.T) {
	serverID := uuid.New()
	ownerID := uuid.New()
	channelID := uuid.New()
	ch := &domain.Channel{ID: channelID, ServerID: serverID, IsPrivate: true, OwnerID: ownerID}

	chRepo := new(MockChannelRepository)
	chRepo.On("GetByID", channelID).Return(ch, nil)

	perms := permsWith(serverID, ownerID, 0)
	uc := usecase.NewServerUseCase(new(MockServerRepository), chRepo, new(MockUserRepository), new(MockRoleRepository), new(MockStorage), perms)

	err := uc.RemoveFromChannel(serverID, channelID, ownerID, ownerID)

	assert.ErrorIs(t, err, domain.ErrCannotRemoveChannelOwner)
	chRepo.AssertNotCalled(t, "RemoveMember", mock.Anything, mock.Anything)
}

func TestRemoveFromChannel_Success(t *testing.T) {
	serverID := uuid.New()
	ownerID := uuid.New()
	memberID := uuid.New()
	channelID := uuid.New()
	ch := &domain.Channel{ID: channelID, ServerID: serverID, IsPrivate: true, OwnerID: ownerID}

	chRepo := new(MockChannelRepository)
	chRepo.On("GetByID", channelID).Return(ch, nil)
	chRepo.On("RemoveMember", channelID, memberID).Return(nil)

	perms := permsWith(serverID, ownerID, 0)
	uc := usecase.NewServerUseCase(new(MockServerRepository), chRepo, new(MockUserRepository), new(MockRoleRepository), new(MockStorage), perms)

	err := uc.RemoveFromChannel(serverID, channelID, ownerID, memberID)

	require.NoError(t, err)
}

func TestGetChannelMembers_NonManagerForbidden(t *testing.T) {
	serverID := uuid.New()
	ownerID := uuid.New()
	memberID := uuid.New()
	channelID := uuid.New()
	ch := &domain.Channel{ID: channelID, ServerID: serverID, IsPrivate: true, OwnerID: ownerID}

	chRepo := new(MockChannelRepository)
	chRepo.On("GetByID", channelID).Return(ch, nil)

	// memberID could be an invited channel member (can view) but is not a manager.
	perms := permsWith(serverID, memberID, 0)
	uc := usecase.NewServerUseCase(new(MockServerRepository), chRepo, new(MockUserRepository), new(MockRoleRepository), new(MockStorage), perms)

	_, err := uc.GetChannelMembers(serverID, channelID, memberID)

	assert.ErrorIs(t, err, domain.ErrChannelForbidden)
}

func TestGetChannelMembers_OwnerSuccess(t *testing.T) {
	serverID := uuid.New()
	ownerID := uuid.New()
	channelID := uuid.New()
	ch := &domain.Channel{ID: channelID, ServerID: serverID, IsPrivate: true, OwnerID: ownerID}

	chRepo := new(MockChannelRepository)
	chRepo.On("GetByID", channelID).Return(ch, nil)
	chRepo.On("GetMembersWithUsers", channelID).Return([]*domain.ChannelMemberWithUser{{UserID: ownerID}}, nil)

	perms := permsWith(serverID, ownerID, 0)
	uc := usecase.NewServerUseCase(new(MockServerRepository), chRepo, new(MockUserRepository), new(MockRoleRepository), new(MockStorage), perms)

	got, err := uc.GetChannelMembers(serverID, channelID, ownerID)

	require.NoError(t, err)
	require.Len(t, got, 1)
}

// Выход с сервера обязан снимать приглашения в приватные каналы этого
// сервера: иначе при повторном вступлении доступ воскресает молча, без
// нового приглашения от кого-либо.
func TestLeaveServer_ClearsPrivateChannelInvites(t *testing.T) {
	serverID := uuid.New()
	ownerID := uuid.New()
	userID := uuid.New()

	srvRepo := new(MockServerRepository)
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID}, nil)
	srvRepo.On("RemoveMember", serverID, userID).Return(nil)

	chRepo := new(MockChannelRepository)
	chRepo.On("RemoveMemberFromServerChannels", serverID, userID).Return(nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, new(MockUserRepository), new(MockRoleRepository), new(MockStorage), new(MockPermissionUseCase))

	err := uc.LeaveServer(serverID, userID)

	require.NoError(t, err)
	srvRepo.AssertCalled(t, "RemoveMember", serverID, userID)
	chRepo.AssertCalled(t, "RemoveMemberFromServerChannels", serverID, userID)
}

// Владелец не покидает свой сервер — и очистка приглашений не запускается.
func TestLeaveServer_Owner_NoCleanup(t *testing.T) {
	serverID := uuid.New()
	ownerID := uuid.New()

	srvRepo := new(MockServerRepository)
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID}, nil)

	chRepo := new(MockChannelRepository)
	uc := usecase.NewServerUseCase(srvRepo, chRepo, new(MockUserRepository), new(MockRoleRepository), new(MockStorage), new(MockPermissionUseCase))

	err := uc.LeaveServer(serverID, ownerID)

	assert.Error(t, err)
	srvRepo.AssertNotCalled(t, "RemoveMember", mock.Anything, mock.Anything)
	chRepo.AssertNotCalled(t, "RemoveMemberFromServerChannels", mock.Anything, mock.Anything)
}

// Сбой очистки не проглатывается: у usecase нет логгера, а незамеченные
// осиротевшие channel_members — это ровно тот дефект, который чинится.
// Выход идемпотентен, поэтому повтор операции доведёт очистку до конца.
func TestLeaveServer_CleanupFailure_ReturnsError(t *testing.T) {
	serverID := uuid.New()
	userID := uuid.New()

	srvRepo := new(MockServerRepository)
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: uuid.New()}, nil)
	srvRepo.On("RemoveMember", serverID, userID).Return(nil)

	chRepo := new(MockChannelRepository)
	chRepo.On("RemoveMemberFromServerChannels", serverID, userID).Return(fmt.Errorf("db down"))

	uc := usecase.NewServerUseCase(srvRepo, chRepo, new(MockUserRepository), new(MockRoleRepository), new(MockStorage), new(MockPermissionUseCase))

	err := uc.LeaveServer(serverID, userID)

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "db down")
}
