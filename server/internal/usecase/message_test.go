package usecase_test

import (
	"errors"
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

// --- Моки репозиториев ---

type MockMessageRepository struct{ mock.Mock }

func (m *MockMessageRepository) Create(msg *domain.Message) error {
	return m.Called(msg).Error(0)
}
func (m *MockMessageRepository) GetByID(id uuid.UUID) (*domain.Message, error) {
	args := m.Called(id)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*domain.Message), args.Error(1)
}
func (m *MockMessageRepository) GetByChannelID(channelID uuid.UUID, limit, offset int) ([]*domain.Message, error) {
	args := m.Called(channelID, limit, offset)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).([]*domain.Message), args.Error(1)
}
func (m *MockMessageRepository) Search(channelID uuid.UUID, query string, limit, offset int) ([]*domain.MessageWithAuthor, int, error) {
	args := m.Called(channelID, query, limit, offset)
	if args.Get(0) == nil {
		return nil, args.Int(1), args.Error(2)
	}
	return args.Get(0).([]*domain.MessageWithAuthor), args.Int(1), args.Error(2)
}
func (m *MockMessageRepository) GetAround(channelID, messageID uuid.UUID, limit int) ([]*domain.Message, error) {
	args := m.Called(channelID, messageID, limit)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).([]*domain.Message), args.Error(1)
}
func (m *MockMessageRepository) Update(id uuid.UUID, updates map[string]interface{}) error {
	return m.Called(id, updates).Error(0)
}
func (m *MockMessageRepository) Delete(id uuid.UUID) error {
	return m.Called(id).Error(0)
}
func (m *MockMessageRepository) CreateCall(msg *domain.Message) (bool, error) {
	args := m.Called(msg)
	return args.Bool(0), args.Error(1)
}

func (m *MockMessageRepository) EndCall(channelID uuid.UUID) (*domain.Message, bool, error) {
	args := m.Called(channelID)
	if args.Get(0) == nil {
		return nil, args.Bool(1), args.Error(2)
	}
	return args.Get(0).(*domain.Message), args.Bool(1), args.Error(2)
}

func (m *MockMessageRepository) TouchCalls(channelIDs []uuid.UUID) error {
	return m.Called(channelIDs).Error(0)
}

func (m *MockMessageRepository) CloseCallsMissingFrom(channelIDs []uuid.UUID, minAge time.Duration) ([]*domain.Message, error) {
	args := m.Called(channelIDs, minAge)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).([]*domain.Message), args.Error(1)
}

func (m *MockMessageRepository) CloseOrphanedCalls() error {
	return m.Called().Error(0)
}

func (m *MockMessageRepository) AddCallParticipant(channelID, userID uuid.UUID) error {
	return m.Called(channelID, userID).Error(0)
}

type MockChannelRepository struct{ mock.Mock }

func (m *MockChannelRepository) Create(channel *domain.Channel) error {
	return m.Called(channel).Error(0)
}
func (m *MockChannelRepository) GetByID(id uuid.UUID) (*domain.Channel, error) {
	args := m.Called(id)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*domain.Channel), args.Error(1)
}
func (m *MockChannelRepository) GetByServerID(serverID uuid.UUID) ([]*domain.Channel, error) {
	args := m.Called(serverID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).([]*domain.Channel), args.Error(1)
}
func (m *MockChannelRepository) Update(id uuid.UUID, updates map[string]interface{}) error {
	return m.Called(id, updates).Error(0)
}
func (m *MockChannelRepository) Delete(id uuid.UUID) error {
	return m.Called(id).Error(0)
}
func (m *MockChannelRepository) DeleteIfNotLast(id, serverID uuid.UUID) (bool, error) {
	args := m.Called(id, serverID)
	return args.Bool(0), args.Error(1)
}

type MockServerRepository struct{ mock.Mock }

func (m *MockServerRepository) Create(server *domain.Server) error {
	return m.Called(server).Error(0)
}
func (m *MockServerRepository) GetByID(id uuid.UUID) (*domain.Server, error) {
	args := m.Called(id)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*domain.Server), args.Error(1)
}
func (m *MockServerRepository) GetByName(name string) (*domain.Server, error) {
	args := m.Called(name)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*domain.Server), args.Error(1)
}
func (m *MockServerRepository) GetByOwner(ownerID uuid.UUID) ([]*domain.Server, error) {
	args := m.Called(ownerID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).([]*domain.Server), args.Error(1)
}
func (m *MockServerRepository) GetByMember(userID uuid.UUID) ([]*domain.Server, error) {
	args := m.Called(userID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).([]*domain.Server), args.Error(1)
}
func (m *MockServerRepository) Update(id uuid.UUID, updates map[string]interface{}) error {
	return m.Called(id, updates).Error(0)
}
func (m *MockServerRepository) Delete(id uuid.UUID) error {
	return m.Called(id).Error(0)
}
func (m *MockServerRepository) Search(query string, limit, offset int) ([]*domain.Server, error) {
	args := m.Called(query, limit, offset)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).([]*domain.Server), args.Error(1)
}
func (m *MockServerRepository) AddMember(serverID, userID uuid.UUID) error {
	return m.Called(serverID, userID).Error(0)
}
func (m *MockServerRepository) RemoveMember(serverID, userID uuid.UUID) error {
	return m.Called(serverID, userID).Error(0)
}
func (m *MockServerRepository) IsMember(serverID, userID uuid.UUID) (bool, error) {
	args := m.Called(serverID, userID)
	return args.Bool(0), args.Error(1)
}
func (m *MockServerRepository) HasMutualServer(a, b uuid.UUID) (bool, error) {
	args := m.Called(a, b)
	return args.Bool(0), args.Error(1)
}
func (m *MockServerRepository) GetMembersWithUsers(serverID uuid.UUID) ([]*domain.MemberWithUser, error) {
	args := m.Called(serverID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).([]*domain.MemberWithUser), args.Error(1)
}

// --- Тесты ---

func TestCreateMessage_WithSendPermission_Success(t *testing.T) {
	channelID, serverID, userID := uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)
	perms := permsWith(serverID, userID, domain.PermSendMessages)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	msgRepo.On("Create", mock.AnythingOfType("*domain.Message")).Return(nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo, &MockStickerRepository{}, perms, new(MockAttachmentRepository), new(MockStorage))
	msg, err := uc.CreateMessage(channelID, userID, "hello", nil, nil)

	assert.NoError(t, err)
	assert.NotNil(t, msg)
	assert.Equal(t, "hello", msg.Content)
	assert.Equal(t, userID, msg.UserID)
	msgRepo.AssertCalled(t, "Create", mock.AnythingOfType("*domain.Message"))
}

func TestCreateMessage_WithoutSendPermission_Forbidden(t *testing.T) {
	channelID, serverID, userID := uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)
	perms := permsWith(serverID, userID, domain.PermViewChannels)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo, &MockStickerRepository{}, perms, new(MockAttachmentRepository), new(MockStorage))
	got, err := uc.CreateMessage(channelID, userID, "привет", nil, nil)

	assert.Nil(t, got)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	msgRepo.AssertNotCalled(t, "Create", mock.Anything)
}

func TestCreateMessage_ChannelNotFound(t *testing.T) {
	channelID, userID := uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)
	perms := new(MockPermissionUseCase)

	chRepo.On("GetByID", channelID).Return(nil, fmt.Errorf("channel %s: %w", channelID, domain.ErrChannelNotFound))

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo, &MockStickerRepository{}, perms, new(MockAttachmentRepository), new(MockStorage))
	msg, err := uc.CreateMessage(channelID, userID, "hello", nil, nil)

	assert.Nil(t, msg)
	assert.ErrorIs(t, err, domain.ErrChannelNotFound)
	perms.AssertNotCalled(t, "Resolve", mock.Anything, mock.Anything)
	msgRepo.AssertNotCalled(t, "Create", mock.Anything)
}

func TestCreateMessage_Owner_Success(t *testing.T) {
	channelID, serverID, ownerID := uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)
	perms := permsOwner(serverID, ownerID)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	msgRepo.On("Create", mock.AnythingOfType("*domain.Message")).Return(nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo, &MockStickerRepository{}, perms, new(MockAttachmentRepository), new(MockStorage))
	msg, err := uc.CreateMessage(channelID, ownerID, "hello", nil, nil)

	assert.NoError(t, err)
	assert.NotNil(t, msg)
	msgRepo.AssertCalled(t, "Create", mock.AnythingOfType("*domain.Message"))
}

func TestGetMessages_WithViewPermission_ReturnsMessages(t *testing.T) {
	channelID, serverID, userID := uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)
	perms := permsWith(serverID, userID, domain.PermViewChannels)

	want := []*domain.Message{{ID: uuid.New(), ChannelID: channelID, Content: "hi"}}
	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	msgRepo.On("GetByChannelID", channelID, 50, 0).Return(want, nil)

	attachRepo := new(MockAttachmentRepository)
	attachRepo.On("ListByMessageIDs", mock.Anything).Return(map[uuid.UUID][]*domain.Attachment{}, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo, &MockStickerRepository{}, perms, attachRepo, new(MockStorage))
	got, err := uc.GetMessages(channelID, userID, 0, 0) // limit 0 -> нормализуется в 50

	assert.NoError(t, err)
	assert.Equal(t, want, got)
}

func TestGetMessages_WithoutViewPermission_Forbidden(t *testing.T) {
	channelID, serverID, userID := uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)
	perms := permsWith(serverID, userID, 0)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo, &MockStickerRepository{}, perms, new(MockAttachmentRepository), new(MockStorage))
	got, err := uc.GetMessages(channelID, userID, 50, 0)

	assert.Nil(t, got)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	msgRepo.AssertNotCalled(t, "GetByChannelID", mock.Anything, mock.Anything, mock.Anything)
}

func TestGetMessages_Owner_ReturnsMessages(t *testing.T) {
	channelID, serverID, ownerID := uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)
	perms := permsOwner(serverID, ownerID)

	want := []*domain.Message{{ID: uuid.New(), ChannelID: channelID, Content: "hi"}}
	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	msgRepo.On("GetByChannelID", channelID, 50, 0).Return(want, nil)

	attachRepo := new(MockAttachmentRepository)
	attachRepo.On("ListByMessageIDs", mock.Anything).Return(map[uuid.UUID][]*domain.Attachment{}, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo, &MockStickerRepository{}, perms, attachRepo, new(MockStorage))
	got, err := uc.GetMessages(channelID, ownerID, 50, 0)

	assert.NoError(t, err)
	assert.Equal(t, want, got)
}

func TestUpdateMessage_Author_ContentChanged_Success(t *testing.T) {
	channelID, serverID, userID, messageID := uuid.New(), uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)
	perms := permsWith(serverID, userID, domain.PermSendMessages)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	existing := &domain.Message{ID: messageID, ChannelID: channelID, UserID: userID, Content: "old"}
	msgRepo.On("GetByID", messageID).Return(existing, nil)
	msgRepo.On("Update", messageID, map[string]interface{}{"content": "new"}).Return(nil)

	attachRepo := new(MockAttachmentRepository)
	attachRepo.On("ListByMessageIDs", mock.Anything).Return(map[uuid.UUID][]*domain.Attachment{}, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo, &MockStickerRepository{}, perms, attachRepo, new(MockStorage))
	msg, err := uc.UpdateMessage(channelID, messageID, userID, "new")

	assert.NoError(t, err)
	assert.Equal(t, "new", msg.Content)
	msgRepo.AssertCalled(t, "Update", messageID, map[string]interface{}{"content": "new"})
}

func TestUpdateMessage_ContentUnchanged_NoOp(t *testing.T) {
	channelID, serverID, userID, messageID := uuid.New(), uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)
	perms := permsWith(serverID, userID, domain.PermSendMessages)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	existing := &domain.Message{ID: messageID, ChannelID: channelID, UserID: userID, Content: "same"}
	msgRepo.On("GetByID", messageID).Return(existing, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo, &MockStickerRepository{}, perms, new(MockAttachmentRepository), new(MockStorage))
	msg, err := uc.UpdateMessage(channelID, messageID, userID, "same")

	assert.NoError(t, err)
	assert.Equal(t, "same", msg.Content)
	msgRepo.AssertNotCalled(t, "Update", mock.Anything, mock.Anything)
}

func TestUpdateMessage_NotAuthor_Forbidden(t *testing.T) {
	channelID, serverID, userID, authorID, messageID := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)
	perms := permsWith(serverID, userID, domain.PermSendMessages)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	existing := &domain.Message{ID: messageID, ChannelID: channelID, UserID: authorID, Content: "old"}
	msgRepo.On("GetByID", messageID).Return(existing, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo, &MockStickerRepository{}, perms, new(MockAttachmentRepository), new(MockStorage))
	msg, err := uc.UpdateMessage(channelID, messageID, userID, "new")

	assert.Nil(t, msg)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	msgRepo.AssertNotCalled(t, "Update", mock.Anything, mock.Anything)
}

func TestUpdateMessage_MessageNotFound(t *testing.T) {
	channelID, serverID, userID, messageID := uuid.New(), uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)
	perms := permsWith(serverID, userID, domain.PermSendMessages)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	msgRepo.On("GetByID", messageID).Return(nil, fmt.Errorf("message %s: %w", messageID, domain.ErrMessageNotFound))

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo, &MockStickerRepository{}, perms, new(MockAttachmentRepository), new(MockStorage))
	msg, err := uc.UpdateMessage(channelID, messageID, userID, "new")

	assert.Nil(t, msg)
	assert.ErrorIs(t, err, domain.ErrMessageNotFound)
}

func TestUpdateMessage_WrongChannel_NotFound(t *testing.T) {
	channelID, otherChannelID, serverID, userID, messageID := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)
	perms := permsWith(serverID, userID, domain.PermSendMessages)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	existing := &domain.Message{ID: messageID, ChannelID: otherChannelID, UserID: userID, Content: "old"}
	msgRepo.On("GetByID", messageID).Return(existing, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo, &MockStickerRepository{}, perms, new(MockAttachmentRepository), new(MockStorage))
	msg, err := uc.UpdateMessage(channelID, messageID, userID, "new")

	assert.Nil(t, msg)
	assert.ErrorIs(t, err, domain.ErrMessageNotFound)
	msgRepo.AssertNotCalled(t, "Update", mock.Anything, mock.Anything)
}

func TestUpdateMessage_WithoutSendPermission_Forbidden(t *testing.T) {
	channelID, serverID, userID, messageID := uuid.New(), uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)
	perms := permsWith(serverID, userID, 0)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo, &MockStickerRepository{}, perms, new(MockAttachmentRepository), new(MockStorage))
	msg, err := uc.UpdateMessage(channelID, messageID, userID, "new")

	assert.Nil(t, msg)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	msgRepo.AssertNotCalled(t, "GetByID", mock.Anything)
}

func TestDeleteMessage_Author_Success(t *testing.T) {
	channelID, serverID, userID, messageID := uuid.New(), uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)
	perms := permsWith(serverID, userID, domain.PermSendMessages)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	existing := &domain.Message{ID: messageID, ChannelID: channelID, UserID: userID, Content: "bye"}
	msgRepo.On("GetByID", messageID).Return(existing, nil)
	msgRepo.On("Delete", messageID).Return(nil)
	attachRepo := new(MockAttachmentRepository)
	attachRepo.On("ListByMessageIDs", []uuid.UUID{messageID}).
		Return(map[uuid.UUID][]*domain.Attachment{}, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo, &MockStickerRepository{}, perms, attachRepo, new(MockStorage))
	err := uc.DeleteMessage(channelID, messageID, userID)

	assert.NoError(t, err)
	msgRepo.AssertCalled(t, "Delete", messageID)
}

func TestDeleteMessageRemovesAttachmentFiles(t *testing.T) {
	// Строки attachments уносит ON DELETE CASCADE, поэтому после удаления
	// сообщения файлы на диске уже нечем найти: уборщик ходит по строкам в БД.
	// Забирать ключи обязаны до удаления, а удалять файлы — после.
	channelID, serverID, userID, messageID := uuid.New(), uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	perms := permsWith(serverID, userID, domain.PermSendMessages)
	attachRepo := new(MockAttachmentRepository)
	storage := new(MockStorage)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	msgRepo.On("GetByID", messageID).
		Return(&domain.Message{ID: messageID, ChannelID: channelID, UserID: userID}, nil)
	msgRepo.On("Delete", messageID).Return(nil)
	attachRepo.On("ListByMessageIDs", []uuid.UUID{messageID}).Return(
		map[uuid.UUID][]*domain.Attachment{messageID: {
			{ID: uuid.New(), StorageKey: "attachments/c/a.png", ThumbKey: "attachments/c/a_thumb.jpg"},
			{ID: uuid.New(), StorageKey: "attachments/c/b.pdf"},
		}}, nil)
	storage.On("Delete", mock.Anything, mock.Anything).Return(nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, new(MockServerRepository), &MockStickerRepository{}, perms, attachRepo, storage)
	err := uc.DeleteMessage(channelID, messageID, userID)

	require.NoError(t, err)
	storage.AssertCalled(t, "Delete", mock.Anything, "attachments/c/a.png")
	storage.AssertCalled(t, "Delete", mock.Anything, "attachments/c/a_thumb.jpg")
	storage.AssertCalled(t, "Delete", mock.Anything, "attachments/c/b.pdf")
	storage.AssertNumberOfCalls(t, "Delete", 3)
}

func TestDeleteMessageSurvivesStorageFailure(t *testing.T) {
	// Сообщение уже удалено — откатывать нечего. Провал уборки файла не должен
	// превращаться в ошибку у пользователя.
	channelID, serverID, userID, messageID := uuid.New(), uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	perms := permsWith(serverID, userID, domain.PermSendMessages)
	attachRepo := new(MockAttachmentRepository)
	storage := new(MockStorage)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	msgRepo.On("GetByID", messageID).
		Return(&domain.Message{ID: messageID, ChannelID: channelID, UserID: userID}, nil)
	msgRepo.On("Delete", messageID).Return(nil)
	attachRepo.On("ListByMessageIDs", []uuid.UUID{messageID}).Return(
		map[uuid.UUID][]*domain.Attachment{messageID: {
			{ID: uuid.New(), StorageKey: "attachments/c/a.png"},
		}}, nil)
	storage.On("Delete", mock.Anything, mock.Anything).Return(errors.New("disk on fire"))

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, new(MockServerRepository), &MockStickerRepository{}, perms, attachRepo, storage)

	assert.NoError(t, uc.DeleteMessage(channelID, messageID, userID))
}

func TestDeleteMessage_NotAuthor_Forbidden(t *testing.T) {
	channelID, serverID, userID, authorID, messageID := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)
	perms := permsWith(serverID, userID, domain.PermSendMessages)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	existing := &domain.Message{ID: messageID, ChannelID: channelID, UserID: authorID, Content: "bye"}
	msgRepo.On("GetByID", messageID).Return(existing, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo, &MockStickerRepository{}, perms, new(MockAttachmentRepository), new(MockStorage))
	err := uc.DeleteMessage(channelID, messageID, userID)

	assert.ErrorIs(t, err, domain.ErrForbidden)
	msgRepo.AssertNotCalled(t, "Delete", mock.Anything)
}

func TestDeleteMessage_MessageNotFound(t *testing.T) {
	channelID, serverID, userID, messageID := uuid.New(), uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)
	perms := permsWith(serverID, userID, domain.PermSendMessages)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	msgRepo.On("GetByID", messageID).Return(nil, fmt.Errorf("message %s: %w", messageID, domain.ErrMessageNotFound))

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo, &MockStickerRepository{}, perms, new(MockAttachmentRepository), new(MockStorage))
	err := uc.DeleteMessage(channelID, messageID, userID)

	assert.ErrorIs(t, err, domain.ErrMessageNotFound)
}

func TestDeleteMessage_WrongChannel_NotFound(t *testing.T) {
	channelID, otherChannelID, serverID, userID, messageID := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)
	perms := permsWith(serverID, userID, domain.PermSendMessages)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	existing := &domain.Message{ID: messageID, ChannelID: otherChannelID, UserID: userID, Content: "bye"}
	msgRepo.On("GetByID", messageID).Return(existing, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo, &MockStickerRepository{}, perms, new(MockAttachmentRepository), new(MockStorage))
	err := uc.DeleteMessage(channelID, messageID, userID)

	assert.ErrorIs(t, err, domain.ErrMessageNotFound)
	msgRepo.AssertNotCalled(t, "Delete", mock.Anything)
}

func TestDeleteMessage_WithoutSendPermission_Forbidden(t *testing.T) {
	channelID, serverID, userID, messageID := uuid.New(), uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)
	perms := permsWith(serverID, userID, 0)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo, &MockStickerRepository{}, perms, new(MockAttachmentRepository), new(MockStorage))
	err := uc.DeleteMessage(channelID, messageID, userID)

	assert.ErrorIs(t, err, domain.ErrForbidden)
	msgRepo.AssertNotCalled(t, "GetByID", mock.Anything)
}

func TestUpdateMessage_RejectsCallMessage(t *testing.T) {
	channelID, serverID, userID, messageID := uuid.New(), uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)
	perms := permsWith(serverID, userID, domain.PermSendMessages)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	existing := &domain.Message{ID: messageID, ChannelID: channelID, UserID: userID, Kind: "call"}
	msgRepo.On("GetByID", messageID).Return(existing, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo, &MockStickerRepository{}, perms, new(MockAttachmentRepository), new(MockStorage))
	msg, err := uc.UpdateMessage(channelID, messageID, userID, "new")

	assert.Nil(t, msg)
	assert.ErrorIs(t, err, domain.ErrCallMessageImmutable)
	msgRepo.AssertNotCalled(t, "Update", mock.Anything, mock.Anything)
}

func TestDeleteMessage_RejectsCallMessage(t *testing.T) {
	channelID, serverID, userID, messageID := uuid.New(), uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)
	perms := permsWith(serverID, userID, domain.PermSendMessages)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	existing := &domain.Message{ID: messageID, ChannelID: channelID, UserID: userID, Kind: "call"}
	msgRepo.On("GetByID", messageID).Return(existing, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo, &MockStickerRepository{}, perms, new(MockAttachmentRepository), new(MockStorage))
	err := uc.DeleteMessage(channelID, messageID, userID)

	assert.ErrorIs(t, err, domain.ErrCallMessageImmutable)
	msgRepo.AssertNotCalled(t, "Delete", mock.Anything)
}

func TestCreateMessage_ValidUserMention_Success(t *testing.T) {
	channelID, serverID, userID, mentionedID := uuid.New(), uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)
	perms := permsWith(serverID, userID, domain.PermSendMessages)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	srvRepo.On("IsMember", serverID, mentionedID).Return(true, nil)
	msgRepo.On("Create", mock.AnythingOfType("*domain.Message")).Return(nil)

	content := "hi <@" + mentionedID.String() + ">"
	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo, &MockStickerRepository{}, perms, new(MockAttachmentRepository), new(MockStorage))
	msg, err := uc.CreateMessage(channelID, userID, content, nil, nil)

	assert.NoError(t, err)
	assert.Equal(t, content, msg.Content)
}

func TestCreateMessage_MentionNonMember_InvalidMention(t *testing.T) {
	channelID, serverID, userID, mentionedID := uuid.New(), uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)
	perms := permsWith(serverID, userID, domain.PermSendMessages)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	srvRepo.On("IsMember", serverID, mentionedID).Return(false, nil)

	content := "hi <@" + mentionedID.String() + ">"
	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo, &MockStickerRepository{}, perms, new(MockAttachmentRepository), new(MockStorage))
	msg, err := uc.CreateMessage(channelID, userID, content, nil, nil)

	assert.Nil(t, msg)
	assert.ErrorIs(t, err, domain.ErrInvalidMention)
	msgRepo.AssertNotCalled(t, "Create", mock.Anything)
}

func TestCreateMessage_EveryoneWithPermission_Success(t *testing.T) {
	channelID, serverID, userID := uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)
	perms := permsWith(serverID, userID, domain.PermViewChannels|domain.PermSendMessages|domain.PermMentionEveryone)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	msgRepo.On("Create", mock.AnythingOfType("*domain.Message")).Return(nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo, &MockStickerRepository{}, perms, new(MockAttachmentRepository), new(MockStorage))
	got, err := uc.CreateMessage(channelID, userID, "внимание @everyone", nil, nil)

	require.NoError(t, err)
	assert.Equal(t, "внимание @everyone", got.Content)
}

func TestCreateMessage_EveryoneWithoutPermission_Forbidden(t *testing.T) {
	channelID, serverID, userID := uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)
	perms := permsWith(serverID, userID, domain.PermViewChannels|domain.PermSendMessages)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo, &MockStickerRepository{}, perms, new(MockAttachmentRepository), new(MockStorage))
	got, err := uc.CreateMessage(channelID, userID, "внимание @everyone", nil, nil)

	assert.Nil(t, got)
	assert.ErrorIs(t, err, domain.ErrMentionForbidden)
}

func TestCreateMessage_NoMentions_SkipsMentionChecks(t *testing.T) {
	channelID, serverID, userID := uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)
	perms := permsWith(serverID, userID, domain.PermSendMessages)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	msgRepo.On("Create", mock.AnythingOfType("*domain.Message")).Return(nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo, &MockStickerRepository{}, perms, new(MockAttachmentRepository), new(MockStorage))
	msg, err := uc.CreateMessage(channelID, userID, "just a normal message", nil, nil)

	assert.NoError(t, err)
	assert.NotNil(t, msg)
	srvRepo.AssertNotCalled(t, "IsMember", mock.Anything, mock.Anything)
}

func TestSearchMessages_WithViewPermission_ReturnsResults(t *testing.T) {
	channelID, serverID, userID := uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)
	perms := permsWith(serverID, userID, domain.PermViewChannels)

	want := []*domain.MessageWithAuthor{
		{Message: domain.Message{ID: uuid.New(), ChannelID: channelID, Content: "нашёл баг"}, Username: "petya"},
	}
	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	msgRepo.On("Search", channelID, "баг", 25, 0).Return(want, 1, nil)

	attachRepo := new(MockAttachmentRepository)
	attachRepo.On("ListByMessageIDs", mock.Anything).Return(map[uuid.UUID][]*domain.Attachment{}, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo, &MockStickerRepository{}, perms, attachRepo, new(MockStorage))
	got, total, err := uc.SearchMessages(channelID, userID, "баг", 0, 0) // limit 0 -> нормализуется в 25

	assert.NoError(t, err)
	assert.Equal(t, want, got)
	assert.Equal(t, 1, total)
}

func TestSearchMessages_WithoutViewPermission_Forbidden(t *testing.T) {
	channelID, serverID, userID := uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)
	perms := permsWith(serverID, userID, 0)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo, &MockStickerRepository{}, perms, new(MockAttachmentRepository), new(MockStorage))
	got, total, err := uc.SearchMessages(channelID, userID, "баг", 25, 0)

	assert.Nil(t, got)
	assert.Equal(t, 0, total)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	msgRepo.AssertNotCalled(t, "Search", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func TestSearchMessages_LimitCapped(t *testing.T) {
	channelID, serverID, userID := uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)
	perms := permsWith(serverID, userID, domain.PermViewChannels)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	msgRepo.On("Search", channelID, "баг", 50, 0).Return([]*domain.MessageWithAuthor{}, 0, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo, &MockStickerRepository{}, perms, new(MockAttachmentRepository), new(MockStorage))
	_, _, err := uc.SearchMessages(channelID, userID, "баг", 500, 0) // 500 -> кэп 50

	assert.NoError(t, err)
	msgRepo.AssertCalled(t, "Search", channelID, "баг", 50, 0)
}

func TestGetMessagesAround_WithViewPermission_ReturnsMessages(t *testing.T) {
	channelID, serverID, userID, messageID := uuid.New(), uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)
	perms := permsWith(serverID, userID, domain.PermViewChannels)

	want := []*domain.Message{{ID: messageID, ChannelID: channelID, Content: "старое"}}
	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	msgRepo.On("GetAround", channelID, messageID, 25).Return(want, nil)

	attachRepo := new(MockAttachmentRepository)
	attachRepo.On("ListByMessageIDs", mock.Anything).Return(map[uuid.UUID][]*domain.Attachment{}, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo, &MockStickerRepository{}, perms, attachRepo, new(MockStorage))
	got, err := uc.GetMessagesAround(channelID, messageID, userID, 0) // limit 0 -> 25

	assert.NoError(t, err)
	assert.Equal(t, want, got)
}

func TestGetMessagesAround_WithoutViewPermission_Forbidden(t *testing.T) {
	channelID, serverID, userID, messageID := uuid.New(), uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)
	perms := permsWith(serverID, userID, 0)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo, &MockStickerRepository{}, perms, new(MockAttachmentRepository), new(MockStorage))
	got, err := uc.GetMessagesAround(channelID, messageID, userID, 25)

	assert.Nil(t, got)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	msgRepo.AssertNotCalled(t, "GetAround", mock.Anything, mock.Anything, mock.Anything)
}

func TestUpdateMessage_MentionNonMember_InvalidMention(t *testing.T) {
	channelID, serverID, userID, messageID, mentionedID := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)
	perms := permsWith(serverID, userID, domain.PermSendMessages)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	srvRepo.On("IsMember", serverID, mentionedID).Return(false, nil)
	existing := &domain.Message{ID: messageID, ChannelID: channelID, UserID: userID, Content: "old"}
	msgRepo.On("GetByID", messageID).Return(existing, nil)

	content := "hi <@" + mentionedID.String() + ">"
	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo, &MockStickerRepository{}, perms, new(MockAttachmentRepository), new(MockStorage))
	msg, err := uc.UpdateMessage(channelID, messageID, userID, content)

	assert.Nil(t, msg)
	assert.ErrorIs(t, err, domain.ErrInvalidMention)
	msgRepo.AssertNotCalled(t, "Update", mock.Anything, mock.Anything)
}

func TestMessageUseCase_CreateStickerMessage_EmptyIsAllowed(t *testing.T) {
	ch := &domain.Channel{ID: uuid.New(), ServerID: uuid.New()}
	chRepo := new(MockChannelRepository)
	chRepo.On("GetByID", ch.ID).Return(ch, nil)

	perms := new(MockPermissionUseCase)
	perms.On("Resolve", ch.ServerID, mock.Anything).Return(domain.PermissionSet{Bits: domain.PermSendMessages}, nil)

	sticker := &domain.Sticker{ID: uuid.New(), ServerID: ch.ServerID}
	stickerRepo := new(MockStickerRepository)
	stickerRepo.On("GetByID", sticker.ID).Return(sticker, nil)

	msgRepo := new(MockMessageRepository)
	msgRepo.On("Create", mock.MatchedBy(func(m *domain.Message) bool { return m.StickerID != nil })).Return(nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, &MockServerRepository{}, stickerRepo, perms, new(MockAttachmentRepository), new(MockStorage))
	msg, err := uc.CreateMessage(ch.ID, uuid.New(), "", &sticker.ID, nil)
	require.NoError(t, err)
	assert.Equal(t, "", msg.Content)
	assert.Equal(t, sticker.ID, *msg.StickerID)
	assert.Equal(t, sticker, msg.Sticker)
	msgRepo.AssertCalled(t, "Create", mock.Anything)
}

func TestMessageUseCase_CreateStickerMessage_InvalidServer(t *testing.T) {
	ch := &domain.Channel{ID: uuid.New(), ServerID: uuid.New()}
	chRepo := new(MockChannelRepository)
	chRepo.On("GetByID", ch.ID).Return(ch, nil)

	perms := new(MockPermissionUseCase)
	perms.On("Resolve", ch.ServerID, mock.Anything).Return(domain.PermissionSet{Bits: domain.PermSendMessages}, nil)

	// Стикер принадлежит другому серверу.
	sticker := &domain.Sticker{ID: uuid.New(), ServerID: uuid.New()}
	stickerRepo := new(MockStickerRepository)
	stickerRepo.On("GetByID", sticker.ID).Return(sticker, nil)

	msgRepo := new(MockMessageRepository)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, &MockServerRepository{}, stickerRepo, perms, new(MockAttachmentRepository), new(MockStorage))
	msg, err := uc.CreateMessage(ch.ID, uuid.New(), "", &sticker.ID, nil)
	assert.Nil(t, msg)
	assert.ErrorIs(t, err, domain.ErrStickerNotFound)
	msgRepo.AssertNotCalled(t, "Create", mock.Anything)
}

func TestCreateMessageWithAttachmentsLinksThem(t *testing.T) {
	channelID, userID, serverID := uuid.New(), uuid.New(), uuid.New()
	attID := uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)
	perms := new(MockPermissionUseCase)
	attachRepo := new(MockAttachmentRepository)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	perms.On("Resolve", serverID, userID).Return(domain.PermissionSet{Bits: domain.PermAll}, nil)
	msgRepo.On("Create", mock.Anything).Return(nil)
	attachRepo.On("AttachToMessage", mock.Anything, userID, channelID, []uuid.UUID{attID}).Return(nil)
	attachRepo.On("ListByMessageIDs", mock.Anything).Return(map[uuid.UUID][]*domain.Attachment{}, nil).Maybe()

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo, new(MockStickerRepository), perms, attachRepo, new(MockStorage))

	msg, err := uc.CreateMessage(channelID, userID, "смотри", nil, []uuid.UUID{attID})

	require.NoError(t, err)
	assert.Equal(t, "смотри", msg.Content)
	attachRepo.AssertExpectations(t)
}

func TestCreateMessageAllowsEmptyTextWhenAttachmentPresent(t *testing.T) {
	// Файл без подписи — нормальное сообщение. Раньше пустой текст был ошибкой.
	channelID, userID, serverID := uuid.New(), uuid.New(), uuid.New()
	attID := uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	perms := new(MockPermissionUseCase)
	attachRepo := new(MockAttachmentRepository)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	perms.On("Resolve", serverID, userID).Return(domain.PermissionSet{Bits: domain.PermAll}, nil)
	msgRepo.On("Create", mock.Anything).Return(nil)
	attachRepo.On("AttachToMessage", mock.Anything, userID, channelID, []uuid.UUID{attID}).Return(nil)
	// После успешной привязки usecase подтягивает вложения — без этой заглушки
	// мок testify паникует на незаявленном вызове.
	attachRepo.On("ListByMessageIDs", mock.Anything).Return(map[uuid.UUID][]*domain.Attachment{}, nil).Maybe()

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, new(MockServerRepository), new(MockStickerRepository), perms, attachRepo, new(MockStorage))

	_, err := uc.CreateMessage(channelID, userID, "", nil, []uuid.UUID{attID})

	assert.NoError(t, err)
}

func TestCreateMessageStillRejectsFullyEmptyMessage(t *testing.T) {
	channelID, userID, serverID := uuid.New(), uuid.New(), uuid.New()
	chRepo := new(MockChannelRepository)
	perms := new(MockPermissionUseCase)
	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	perms.On("Resolve", serverID, userID).Return(domain.PermissionSet{Bits: domain.PermAll}, nil)

	uc := usecase.NewMessageUseCase(new(MockMessageRepository), chRepo, new(MockServerRepository),
		new(MockStickerRepository), perms, new(MockAttachmentRepository), new(MockStorage))

	_, err := uc.CreateMessage(channelID, userID, "", nil, nil)

	assert.ErrorIs(t, err, domain.ErrMessageEmpty)
}

func TestCreateMessageRejectsForeignAttachment(t *testing.T) {
	// Чужой id не должен «прилипнуть» к своему сообщению: условия
	// принадлежности проверяет AttachToMessage.
	channelID, userID, serverID := uuid.New(), uuid.New(), uuid.New()
	attID := uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	perms := new(MockPermissionUseCase)
	attachRepo := new(MockAttachmentRepository)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	perms.On("Resolve", serverID, userID).Return(domain.PermissionSet{Bits: domain.PermAll}, nil)
	msgRepo.On("Create", mock.Anything).Return(nil)
	msgRepo.On("Delete", mock.Anything).Return(nil)
	attachRepo.On("AttachToMessage", mock.Anything, userID, channelID, []uuid.UUID{attID}).
		Return(domain.ErrAttachmentNotFound)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, new(MockServerRepository), new(MockStickerRepository), perms, attachRepo, new(MockStorage))

	_, err := uc.CreateMessage(channelID, userID, "текст", nil, []uuid.UUID{attID})

	assert.ErrorIs(t, err, domain.ErrAttachmentNotFound)
	// Сообщение без своих вложений остаться не должно.
	msgRepo.AssertCalled(t, "Delete", mock.Anything)
}

func TestCreateMessageRejectsStickerWithAttachments(t *testing.T) {
	channelID, userID, serverID := uuid.New(), uuid.New(), uuid.New()
	stickerID := uuid.New()
	chRepo := new(MockChannelRepository)
	perms := new(MockPermissionUseCase)
	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	perms.On("Resolve", serverID, userID).Return(domain.PermissionSet{Bits: domain.PermAll}, nil)

	uc := usecase.NewMessageUseCase(new(MockMessageRepository), chRepo, new(MockServerRepository),
		new(MockStickerRepository), perms, new(MockAttachmentRepository), new(MockStorage))

	_, err := uc.CreateMessage(channelID, userID, "", &stickerID, []uuid.UUID{uuid.New()})

	assert.Error(t, err)
}

func TestCreateMessageDedupesDuplicateAttachmentIDs(t *testing.T) {
	// Повтор id в attachment_ids — баг клиента. Без дедупа AttachToMessage
	// обновил бы одну строку, RowsAffected != len(ids), и наружу ушла бы
	// ErrAttachmentAlreadyAttached вместо того, чтобы просто привязать файл.
	channelID, userID, serverID := uuid.New(), uuid.New(), uuid.New()
	attID := uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	perms := new(MockPermissionUseCase)
	attachRepo := new(MockAttachmentRepository)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	perms.On("Resolve", serverID, userID).Return(domain.PermissionSet{Bits: domain.PermAll}, nil)
	msgRepo.On("Create", mock.Anything).Return(nil)
	attachRepo.On("AttachToMessage", mock.Anything, userID, channelID, []uuid.UUID{attID}).Return(nil)
	attachRepo.On("ListByMessageIDs", mock.Anything).Return(map[uuid.UUID][]*domain.Attachment{}, nil).Maybe()

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, new(MockServerRepository), new(MockStickerRepository), perms, attachRepo, new(MockStorage))

	_, err := uc.CreateMessage(channelID, userID, "текст", nil, []uuid.UUID{attID, attID})

	require.NoError(t, err)
	attachRepo.AssertCalled(t, "AttachToMessage", mock.Anything, userID, channelID, []uuid.UUID{attID})
}

func TestUpdateMessageKeepsAttachments(t *testing.T) {
	// Без подтягивания вложений поле уходит пустым, а из-за omitempty ключа
	// в JSON не будет вовсе — клиент потеряет картинки при правке текста.
	channelID, userID, serverID := uuid.New(), uuid.New(), uuid.New()
	msgID, attID := uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	perms := new(MockPermissionUseCase)
	attachRepo := new(MockAttachmentRepository)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	perms.On("Resolve", serverID, userID).Return(domain.PermissionSet{Bits: domain.PermAll}, nil)
	msgRepo.On("GetByID", msgID).Return(&domain.Message{ID: msgID, ChannelID: channelID, UserID: userID}, nil)
	msgRepo.On("Update", msgID, mock.Anything).Return(nil)
	attachRepo.On("ListByMessageIDs", []uuid.UUID{msgID}).
		Return(map[uuid.UUID][]*domain.Attachment{msgID: {{ID: attID, Kind: domain.AttachmentKindImage}}}, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, new(MockServerRepository), new(MockStickerRepository), perms, attachRepo, new(MockStorage))

	msg, err := uc.UpdateMessage(channelID, msgID, userID, "новый текст")

	require.NoError(t, err)
	require.Len(t, msg.Attachments, 1)
	assert.Equal(t, attID, msg.Attachments[0].ID)
}

func TestCreateMessageSurfacesRollbackFailure(t *testing.T) {
	// Если и откат не удался, вызывающий обязан узнать об этом, а не считать,
	// что не создалось ничего.
	channelID, userID, serverID := uuid.New(), uuid.New(), uuid.New()
	attID := uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	perms := new(MockPermissionUseCase)
	attachRepo := new(MockAttachmentRepository)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	perms.On("Resolve", serverID, userID).Return(domain.PermissionSet{Bits: domain.PermAll}, nil)
	msgRepo.On("Create", mock.Anything).Return(nil)
	msgRepo.On("Delete", mock.Anything).Return(errors.New("db is down"))
	attachRepo.On("AttachToMessage", mock.Anything, userID, channelID, []uuid.UUID{attID}).
		Return(domain.ErrAttachmentNotFound)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, new(MockServerRepository), new(MockStickerRepository), perms, attachRepo, new(MockStorage))

	_, err := uc.CreateMessage(channelID, userID, "текст", nil, []uuid.UUID{attID})

	// Исходная ошибка обязана сохраниться для errors.Is — от неё зависит
	// HTTP-статус; сведения о провале отката добавляются к тексту.
	assert.ErrorIs(t, err, domain.ErrAttachmentNotFound)
	assert.Contains(t, err.Error(), "откат не удался")
}
