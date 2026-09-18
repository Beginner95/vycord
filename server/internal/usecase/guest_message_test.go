package usecase_test

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"

	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/internal/usecase"
)

func guestMessageUseCase(msgRepo *MockMessageRepository, perms *MockPermissionUseCase) domain.MessageUseCase {
	return usecase.NewMessageUseCase(msgRepo, new(MockChannelRepository), new(MockServerRepository),
		&MockStickerRepository{}, perms, new(MockAttachmentRepository), new(MockStorage))
}

func admittedGuest(channelID uuid.UUID, admittedAt time.Time) *domain.GuestContext {
	return &domain.GuestContext{
		Guest: domain.CallGuest{
			ID: uuid.New(), ChannelID: channelID, DisplayName: "Вася",
			Status: domain.GuestStatusAdmitted, AdmittedAt: &admittedAt,
		},
		GuestLinksEnabled: true,
	}
}

func TestCreateGuestMessage(t *testing.T) {
	channelID := uuid.New()
	msgRepo := new(MockMessageRepository)
	uc := guestMessageUseCase(msgRepo, new(MockPermissionUseCase))
	gc := admittedGuest(channelID, time.Now())
	msgRepo.On("CreateGuest", mock.AnythingOfType("*domain.Message")).Return(nil)

	msg, err := uc.CreateGuestMessage(gc, "  привет  ")
	require.NoError(t, err)
	assert.Equal(t, "привет", msg.Content)
	assert.Nil(t, msg.UserID)
	require.NotNil(t, msg.GuestID)
	assert.Equal(t, gc.Guest.ID, *msg.GuestID)
	require.NotNil(t, msg.Guest)
	assert.Equal(t, "Вася", msg.Guest.DisplayName)
	assert.Equal(t, "user", msg.Kind)
	assert.Equal(t, channelID, msg.ChannelID)
}

func TestCreateGuestMessageRefusals(t *testing.T) {
	channelID := uuid.New()
	cases := map[string]struct {
		guest   *domain.GuestContext
		content string
		want    error
	}{
		"not admitted":     {&domain.GuestContext{Guest: domain.CallGuest{ChannelID: channelID, Status: domain.GuestStatusLobby}}, "hi", domain.ErrGuestNotAdmitted},
		"empty":            {admittedGuest(channelID, time.Now()), "   ", domain.ErrMessageEmpty},
		"too long":         {admittedGuest(channelID, time.Now()), strings.Repeat("я", domain.GuestMessageMaxLen+1), domain.ErrGuestMessageTooLong},
		"user mention":     {admittedGuest(channelID, time.Now()), "привет <@" + uuid.NewString() + ">", domain.ErrGuestMentionForbidden},
		"role mention":     {admittedGuest(channelID, time.Now()), "эй <@&admin>", domain.ErrGuestMentionForbidden},
		"everyone mention": {admittedGuest(channelID, time.Now()), "@everyone смотрите", domain.ErrGuestMentionForbidden},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			msgRepo := new(MockMessageRepository)
			uc := guestMessageUseCase(msgRepo, new(MockPermissionUseCase))
			_, err := uc.CreateGuestMessage(c.guest, c.content)
			assert.ErrorIs(t, err, c.want)
			msgRepo.AssertNotCalled(t, "CreateGuest", mock.Anything)
		})
	}

	t.Run("exactly at the limit is fine", func(t *testing.T) {
		msgRepo := new(MockMessageRepository)
		msgRepo.On("CreateGuest", mock.Anything).Return(nil)
		uc := guestMessageUseCase(msgRepo, new(MockPermissionUseCase))
		_, err := uc.CreateGuestMessage(admittedGuest(channelID, time.Now()), strings.Repeat("я", domain.GuestMessageMaxLen))
		assert.NoError(t, err)
	})
}

// Н13
func TestListGuestMessagesWindow(t *testing.T) {
	channelID := uuid.New()
	admittedAt := time.Now()
	gc := admittedGuest(channelID, admittedAt)

	t.Run("cursor older than admission is ignored", func(t *testing.T) {
		msgRepo := new(MockMessageRepository)
		old := &domain.Message{ID: uuid.New(), ChannelID: channelID, CreatedAt: admittedAt.Add(-time.Hour)}
		msgRepo.On("GetByID", old.ID).Return(old, nil)
		msgRepo.On("ListForGuest", channelID, admittedAt, (*domain.Message)(nil), 50).Return([]*domain.GuestChatMessage{}, nil)

		uc := guestMessageUseCase(msgRepo, new(MockPermissionUseCase))
		_, err := uc.ListGuestMessages(gc, &old.ID, 0)
		require.NoError(t, err)
		msgRepo.AssertExpectations(t)
	})

	t.Run("cursor from another channel is ignored", func(t *testing.T) {
		msgRepo := new(MockMessageRepository)
		foreign := &domain.Message{ID: uuid.New(), ChannelID: uuid.New(), CreatedAt: admittedAt.Add(time.Minute)}
		msgRepo.On("GetByID", foreign.ID).Return(foreign, nil)
		msgRepo.On("ListForGuest", channelID, admittedAt, (*domain.Message)(nil), 50).Return(nil, nil)

		uc := guestMessageUseCase(msgRepo, new(MockPermissionUseCase))
		_, err := uc.ListGuestMessages(gc, &foreign.ID, 0)
		require.NoError(t, err)
		msgRepo.AssertExpectations(t)
	})

	t.Run("valid cursor is used and the limit is clamped", func(t *testing.T) {
		msgRepo := new(MockMessageRepository)
		cursor := &domain.Message{ID: uuid.New(), ChannelID: channelID, CreatedAt: admittedAt.Add(time.Minute)}
		msgRepo.On("GetByID", cursor.ID).Return(cursor, nil)
		msgRepo.On("ListForGuest", channelID, admittedAt, cursor, 50).Return(nil, nil)

		uc := guestMessageUseCase(msgRepo, new(MockPermissionUseCase))
		_, err := uc.ListGuestMessages(gc, &cursor.ID, 500)
		require.NoError(t, err)
		msgRepo.AssertExpectations(t)
	})

	t.Run("not admitted", func(t *testing.T) {
		msgRepo := new(MockMessageRepository)
		uc := guestMessageUseCase(msgRepo, new(MockPermissionUseCase))
		_, err := uc.ListGuestMessages(&domain.GuestContext{Guest: domain.CallGuest{Status: domain.GuestStatusLobby}}, nil, 10)
		assert.ErrorIs(t, err, domain.ErrGuestNotAdmitted)
	})
}

// Н29
func TestDeleteGuestMessage(t *testing.T) {
	channelID, serverID, messageID, guestID := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	guestMsg := func() *domain.Message {
		return &domain.Message{ID: messageID, ChannelID: channelID, GuestID: &guestID, Kind: "user"}
	}

	t.Run("plain member cannot delete a guest message", func(t *testing.T) {
		userID := uuid.New()
		msgRepo := new(MockMessageRepository)
		chRepo := new(MockChannelRepository)
		chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
		msgRepo.On("GetByID", messageID).Return(guestMsg(), nil)
		perms := permsWith(serverID, userID, domain.PermSendMessages)

		uc := usecase.NewMessageUseCase(msgRepo, chRepo, new(MockServerRepository), &MockStickerRepository{},
			perms, new(MockAttachmentRepository), new(MockStorage))
		assert.ErrorIs(t, uc.DeleteMessage(channelID, messageID, userID), domain.ErrForbidden)
		msgRepo.AssertNotCalled(t, "Delete", mock.Anything)
	})

	t.Run("administrator can delete a guest message", func(t *testing.T) {
		userID := uuid.New()
		msgRepo := new(MockMessageRepository)
		chRepo := new(MockChannelRepository)
		chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
		msgRepo.On("GetByID", messageID).Return(guestMsg(), nil)
		msgRepo.On("Delete", messageID).Return(nil)
		attachRepo := new(MockAttachmentRepository)
		attachRepo.On("ListByMessageIDs", []uuid.UUID{messageID}).Return(map[uuid.UUID][]*domain.Attachment{}, nil)
		perms := permsWith(serverID, userID, domain.PermAdministrator)

		uc := usecase.NewMessageUseCase(msgRepo, chRepo, new(MockServerRepository), &MockStickerRepository{},
			perms, attachRepo, new(MockStorage))
		require.NoError(t, uc.DeleteMessage(channelID, messageID, userID))
	})

	t.Run("administrator still cannot delete another user's message", func(t *testing.T) {
		userID, authorID := uuid.New(), uuid.New()
		msgRepo := new(MockMessageRepository)
		chRepo := new(MockChannelRepository)
		chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
		msgRepo.On("GetByID", messageID).Return(&domain.Message{ID: messageID, ChannelID: channelID, UserID: &authorID, Kind: "user"}, nil)
		perms := permsWith(serverID, userID, domain.PermAdministrator)

		uc := usecase.NewMessageUseCase(msgRepo, chRepo, new(MockServerRepository), &MockStickerRepository{},
			perms, new(MockAttachmentRepository), new(MockStorage))
		assert.ErrorIs(t, uc.DeleteMessage(channelID, messageID, userID), domain.ErrForbidden)
	})
}
