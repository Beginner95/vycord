package usecase_test

import (
	"fmt"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"

	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/internal/usecase"
)

func TestGetMembers_Owner_Success(t *testing.T) {
	serverID, ownerID := uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	storage := new(MockStorage)

	want := []*domain.MemberWithUser{{UserID: ownerID, Username: "owner", Role: domain.RoleOwner}}
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

	want := []*domain.MemberWithUser{{UserID: userID, Username: "member", Role: domain.RoleMember}}
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
	serverID, ownerID, channelID, otherChannelID := uuid.New(), uuid.New(), uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	storage := new(MockStorage)

	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID}, nil)
	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	chRepo.On("GetByServerID", serverID).Return([]*domain.Channel{
		{ID: channelID, ServerID: serverID},
		{ID: otherChannelID, ServerID: serverID},
	}, nil)
	chRepo.On("Delete", channelID).Return(nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, storage)
	err := uc.DeleteChannel(serverID, channelID, ownerID)

	assert.NoError(t, err)
	chRepo.AssertCalled(t, "Delete", channelID)
}

func TestDeleteChannel_LastChannel_Rejected(t *testing.T) {
	serverID, ownerID, channelID := uuid.New(), uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	storage := new(MockStorage)

	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID}, nil)
	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	chRepo.On("GetByServerID", serverID).Return([]*domain.Channel{{ID: channelID, ServerID: serverID}}, nil)

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
