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
func (m *MockMessageRepository) Update(id uuid.UUID, updates map[string]interface{}) error {
	return m.Called(id, updates).Error(0)
}
func (m *MockMessageRepository) Delete(id uuid.UUID) error {
	return m.Called(id).Error(0)
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
func (m *MockServerRepository) GetMembersWithUsers(serverID uuid.UUID) ([]*domain.MemberWithUser, error) {
	args := m.Called(serverID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).([]*domain.MemberWithUser), args.Error(1)
}
func (m *MockServerRepository) GetMemberRole(serverID, userID uuid.UUID) (domain.Role, error) {
	args := m.Called(serverID, userID)
	return args.Get(0).(domain.Role), args.Error(1)
}

// --- Тесты ---

func TestCreateMessage_Member_Success(t *testing.T) {
	channelID, serverID, userID := uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: uuid.New()}, nil)
	srvRepo.On("IsMember", serverID, userID).Return(true, nil)
	msgRepo.On("Create", mock.AnythingOfType("*domain.Message")).Return(nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo)
	msg, err := uc.CreateMessage(channelID, userID, "hello")

	assert.NoError(t, err)
	assert.NotNil(t, msg)
	assert.Equal(t, "hello", msg.Content)
	assert.Equal(t, userID, msg.UserID)
	msgRepo.AssertCalled(t, "Create", mock.AnythingOfType("*domain.Message"))
}

func TestCreateMessage_NotMember_Forbidden(t *testing.T) {
	channelID, serverID, userID := uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: uuid.New()}, nil)
	srvRepo.On("IsMember", serverID, userID).Return(false, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo)
	msg, err := uc.CreateMessage(channelID, userID, "hello")

	assert.Nil(t, msg)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	msgRepo.AssertNotCalled(t, "Create", mock.Anything)
}

func TestCreateMessage_ChannelNotFound(t *testing.T) {
	channelID, userID := uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)

	chRepo.On("GetByID", channelID).Return(nil, fmt.Errorf("channel %s: %w", channelID, domain.ErrChannelNotFound))

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo)
	msg, err := uc.CreateMessage(channelID, userID, "hello")

	assert.Nil(t, msg)
	assert.ErrorIs(t, err, domain.ErrChannelNotFound)
	srvRepo.AssertNotCalled(t, "GetByID", mock.Anything)
	srvRepo.AssertNotCalled(t, "IsMember", mock.Anything, mock.Anything)
	msgRepo.AssertNotCalled(t, "Create", mock.Anything)
}

func TestCreateMessage_Owner_Success(t *testing.T) {
	channelID, serverID, ownerID := uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID}, nil)
	msgRepo.On("Create", mock.AnythingOfType("*domain.Message")).Return(nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo)
	msg, err := uc.CreateMessage(channelID, ownerID, "hello")

	assert.NoError(t, err)
	assert.NotNil(t, msg)
	srvRepo.AssertNotCalled(t, "IsMember", mock.Anything, mock.Anything)
	msgRepo.AssertCalled(t, "Create", mock.AnythingOfType("*domain.Message"))
}

func TestGetMessages_Member_ReturnsMessages(t *testing.T) {
	channelID, serverID, userID := uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)

	want := []*domain.Message{{ID: uuid.New(), ChannelID: channelID, Content: "hi"}}
	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: uuid.New()}, nil)
	srvRepo.On("IsMember", serverID, userID).Return(true, nil)
	msgRepo.On("GetByChannelID", channelID, 50, 0).Return(want, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo)
	got, err := uc.GetMessages(channelID, userID, 0, 0) // limit 0 -> нормализуется в 50

	assert.NoError(t, err)
	assert.Equal(t, want, got)
}

func TestGetMessages_NotMember_Forbidden(t *testing.T) {
	channelID, serverID, userID := uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: uuid.New()}, nil)
	srvRepo.On("IsMember", serverID, userID).Return(false, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo)
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

	want := []*domain.Message{{ID: uuid.New(), ChannelID: channelID, Content: "hi"}}
	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID}, nil)
	msgRepo.On("GetByChannelID", channelID, 50, 0).Return(want, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo)
	got, err := uc.GetMessages(channelID, ownerID, 50, 0)

	assert.NoError(t, err)
	assert.Equal(t, want, got)
	srvRepo.AssertNotCalled(t, "IsMember", mock.Anything, mock.Anything)
}

func TestUpdateMessage_Author_ContentChanged_Success(t *testing.T) {
	channelID, serverID, userID, messageID := uuid.New(), uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: uuid.New()}, nil)
	srvRepo.On("IsMember", serverID, userID).Return(true, nil)
	existing := &domain.Message{ID: messageID, ChannelID: channelID, UserID: userID, Content: "old"}
	msgRepo.On("GetByID", messageID).Return(existing, nil)
	msgRepo.On("Update", messageID, map[string]interface{}{"content": "new"}).Return(nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo)
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

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: uuid.New()}, nil)
	srvRepo.On("IsMember", serverID, userID).Return(true, nil)
	existing := &domain.Message{ID: messageID, ChannelID: channelID, UserID: userID, Content: "same"}
	msgRepo.On("GetByID", messageID).Return(existing, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo)
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

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: uuid.New()}, nil)
	srvRepo.On("IsMember", serverID, userID).Return(true, nil)
	existing := &domain.Message{ID: messageID, ChannelID: channelID, UserID: authorID, Content: "old"}
	msgRepo.On("GetByID", messageID).Return(existing, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo)
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

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: uuid.New()}, nil)
	srvRepo.On("IsMember", serverID, userID).Return(true, nil)
	msgRepo.On("GetByID", messageID).Return(nil, fmt.Errorf("message %s: %w", messageID, domain.ErrMessageNotFound))

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo)
	msg, err := uc.UpdateMessage(channelID, messageID, userID, "new")

	assert.Nil(t, msg)
	assert.ErrorIs(t, err, domain.ErrMessageNotFound)
}

func TestUpdateMessage_WrongChannel_NotFound(t *testing.T) {
	channelID, otherChannelID, serverID, userID, messageID := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: uuid.New()}, nil)
	srvRepo.On("IsMember", serverID, userID).Return(true, nil)
	existing := &domain.Message{ID: messageID, ChannelID: otherChannelID, UserID: userID, Content: "old"}
	msgRepo.On("GetByID", messageID).Return(existing, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo)
	msg, err := uc.UpdateMessage(channelID, messageID, userID, "new")

	assert.Nil(t, msg)
	assert.ErrorIs(t, err, domain.ErrMessageNotFound)
	msgRepo.AssertNotCalled(t, "Update", mock.Anything, mock.Anything)
}

func TestUpdateMessage_NotMember_Forbidden(t *testing.T) {
	channelID, serverID, userID, messageID := uuid.New(), uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: uuid.New()}, nil)
	srvRepo.On("IsMember", serverID, userID).Return(false, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo)
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

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: uuid.New()}, nil)
	srvRepo.On("IsMember", serverID, userID).Return(true, nil)
	existing := &domain.Message{ID: messageID, ChannelID: channelID, UserID: userID, Content: "bye"}
	msgRepo.On("GetByID", messageID).Return(existing, nil)
	msgRepo.On("Delete", messageID).Return(nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo)
	err := uc.DeleteMessage(channelID, messageID, userID)

	assert.NoError(t, err)
	msgRepo.AssertCalled(t, "Delete", messageID)
}

func TestDeleteMessage_NotAuthor_Forbidden(t *testing.T) {
	channelID, serverID, userID, authorID, messageID := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: uuid.New()}, nil)
	srvRepo.On("IsMember", serverID, userID).Return(true, nil)
	existing := &domain.Message{ID: messageID, ChannelID: channelID, UserID: authorID, Content: "bye"}
	msgRepo.On("GetByID", messageID).Return(existing, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo)
	err := uc.DeleteMessage(channelID, messageID, userID)

	assert.ErrorIs(t, err, domain.ErrForbidden)
	msgRepo.AssertNotCalled(t, "Delete", mock.Anything)
}

func TestDeleteMessage_MessageNotFound(t *testing.T) {
	channelID, serverID, userID, messageID := uuid.New(), uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: uuid.New()}, nil)
	srvRepo.On("IsMember", serverID, userID).Return(true, nil)
	msgRepo.On("GetByID", messageID).Return(nil, fmt.Errorf("message %s: %w", messageID, domain.ErrMessageNotFound))

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo)
	err := uc.DeleteMessage(channelID, messageID, userID)

	assert.ErrorIs(t, err, domain.ErrMessageNotFound)
}

func TestDeleteMessage_WrongChannel_NotFound(t *testing.T) {
	channelID, otherChannelID, serverID, userID, messageID := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: uuid.New()}, nil)
	srvRepo.On("IsMember", serverID, userID).Return(true, nil)
	existing := &domain.Message{ID: messageID, ChannelID: otherChannelID, UserID: userID, Content: "bye"}
	msgRepo.On("GetByID", messageID).Return(existing, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo)
	err := uc.DeleteMessage(channelID, messageID, userID)

	assert.ErrorIs(t, err, domain.ErrMessageNotFound)
	msgRepo.AssertNotCalled(t, "Delete", mock.Anything)
}

func TestDeleteMessage_NotMember_Forbidden(t *testing.T) {
	channelID, serverID, userID, messageID := uuid.New(), uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: uuid.New()}, nil)
	srvRepo.On("IsMember", serverID, userID).Return(false, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo)
	err := uc.DeleteMessage(channelID, messageID, userID)

	assert.ErrorIs(t, err, domain.ErrForbidden)
	msgRepo.AssertNotCalled(t, "GetByID", mock.Anything)
}
