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

func TestGetMembers_Owner_Success(t *testing.T) {
	serverID, ownerID := uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	storage := new(MockStorage)

	want := []*domain.MemberWithUser{{UserID: ownerID, Username: "owner", Role: "owner"}}
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID}, nil)
	srvRepo.On("GetMembersWithUsers", serverID).Return(want, nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, storage)
	got, err := uc.GetMembers(serverID, ownerID)

	assert.NoError(t, err)
	assert.Equal(t, want, got)
	srvRepo.AssertNotCalled(t, "IsMember", mock.Anything, mock.Anything)
}

func TestGetMembers_Member_Success(t *testing.T) {
	serverID, ownerID, userID := uuid.New(), uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	storage := new(MockStorage)

	want := []*domain.MemberWithUser{{UserID: userID, Username: "member", Role: "member"}}
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID}, nil)
	srvRepo.On("IsMember", serverID, userID).Return(true, nil)
	srvRepo.On("GetMembersWithUsers", serverID).Return(want, nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, storage)
	got, err := uc.GetMembers(serverID, userID)

	assert.NoError(t, err)
	assert.Equal(t, want, got)
}

func TestGetMembers_NotMember_Forbidden(t *testing.T) {
	serverID, ownerID, userID := uuid.New(), uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	storage := new(MockStorage)

	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID}, nil)
	srvRepo.On("IsMember", serverID, userID).Return(false, nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, storage)
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

	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID, Name: "old"}, nil)
	srvRepo.On("Update", serverID, map[string]interface{}{"name": "new"}).Return(nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, storage)
	got, err := uc.UpdateServer(serverID, ownerID, "new")

	assert.NoError(t, err)
	assert.Equal(t, "new", got.Name)
	srvRepo.AssertCalled(t, "Update", serverID, map[string]interface{}{"name": "new"})
}

func TestUpdateServer_NotOwner_Forbidden(t *testing.T) {
	serverID, ownerID, userID := uuid.New(), uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	storage := new(MockStorage)

	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID}, nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, storage)
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

	srvRepo.On("GetByID", serverID).Return(nil, fmt.Errorf("server not found"))

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, storage)
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

	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID}, nil)
	srvRepo.On("Delete", serverID).Return(nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, storage)
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

	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID}, nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, storage)
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

	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID}, nil)
	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID, Name: "old"}, nil)
	chRepo.On("Update", channelID, map[string]interface{}{"name": "new"}).Return(nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, storage)
	got, err := uc.UpdateChannel(serverID, channelID, ownerID, "new")

	assert.NoError(t, err)
	assert.Equal(t, "new", got.Name)
}

func TestUpdateChannel_NotOwner_Forbidden(t *testing.T) {
	serverID, ownerID, userID, channelID := uuid.New(), uuid.New(), uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	storage := new(MockStorage)

	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID}, nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, storage)
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

	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID}, nil)
	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: otherServerID}, nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, storage)
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

	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID}, nil)
	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	chRepo.On("DeleteIfNotLast", channelID, serverID).Return(true, nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, storage)
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

	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID}, nil)
	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	chRepo.On("DeleteIfNotLast", channelID, serverID).Return(false, nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, storage)
	err := uc.DeleteChannel(serverID, channelID, ownerID)

	assert.ErrorIs(t, err, domain.ErrLastChannel)
	chRepo.AssertNotCalled(t, "Delete", mock.Anything)
}

func TestDeleteChannel_NotOwner_Forbidden(t *testing.T) {
	serverID, ownerID, userID, channelID := uuid.New(), uuid.New(), uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	storage := new(MockStorage)

	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID}, nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, storage)
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

	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID}, nil)
	storage.On("Save", mock.Anything, mock.MatchedBy(func(key string) bool {
		return strings.HasPrefix(key, "server-icons/"+serverID.String()+"/") && strings.HasSuffix(key, ".png")
	}), mock.Anything, "image/png").Return("/uploads/server-icons/x/y.png", nil)
	srvRepo.On("Update", serverID, map[string]interface{}{"icon_url": "/uploads/server-icons/x/y.png"}).Return(nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, storage)
	got, err := uc.UpdateServerIcon(serverID, ownerID, fakePNGBytes(64, 64))

	require.NoError(t, err)
	require.NotNil(t, got.IconURL)
	assert.Equal(t, "/uploads/server-icons/x/y.png", *got.IconURL)
}

func TestUpdateServerIcon_NotOwner_Forbidden(t *testing.T) {
	serverID, ownerID, userID := uuid.New(), uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	storage := new(MockStorage)

	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID}, nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, storage)
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

	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID}, nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, storage)
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

	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID, IconURL: &oldURL}, nil)
	srvRepo.On("Update", serverID, map[string]interface{}{"icon_url": nil}).Return(nil)
	storage.On("Delete", mock.Anything, oldURL).Return(nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, storage)
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

	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID}, nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, storage)
	got, err := uc.RemoveServerIcon(serverID, ownerID)

	require.NoError(t, err)
	assert.Nil(t, got.IconURL)
	srvRepo.AssertNotCalled(t, "Update", mock.Anything, mock.Anything)
	storage.AssertNotCalled(t, "Delete", mock.Anything, mock.Anything)
}

func TestRemoveServerIcon_NotOwner_Forbidden(t *testing.T) {
	serverID, ownerID, userID := uuid.New(), uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	storage := new(MockStorage)

	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID}, nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, storage)
	got, err := uc.RemoveServerIcon(serverID, userID)

	assert.Nil(t, got)
	assert.ErrorIs(t, err, domain.ErrForbidden)
}
