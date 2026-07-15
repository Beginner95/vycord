package usecase

import (
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/domain"
)

type messageUseCase struct {
	messageRepo domain.MessageRepository
	channelRepo domain.ChannelRepository
	serverRepo  domain.ServerRepository
}

func NewMessageUseCase(
	messageRepo domain.MessageRepository,
	channelRepo domain.ChannelRepository,
	serverRepo domain.ServerRepository,
) domain.MessageUseCase {
	return &messageUseCase{
		messageRepo: messageRepo,
		channelRepo: channelRepo,
		serverRepo:  serverRepo,
	}
}

// requireMembership проверяет, что канал существует и пользователь состоит в его
// сервере. Возвращает domain.ErrChannelNotFound (обёрнуто) или domain.ErrForbidden.
func (uc *messageUseCase) requireMembership(channelID, userID uuid.UUID) error {
	ch, err := uc.channelRepo.GetByID(channelID)
	if err != nil {
		return fmt.Errorf("get channel: %w", err)
	}

	server, err := uc.serverRepo.GetByID(ch.ServerID)
	if err != nil {
		return fmt.Errorf("get server: %w", err)
	}
	// Владелец сервера трекается через servers.owner_id, а не в server_members
	// (см. JoinServer), поэтому доступ владельца проверяем отдельно.
	if server.OwnerID == userID {
		return nil
	}

	isMember, err := uc.serverRepo.IsMember(ch.ServerID, userID)
	if err != nil {
		return fmt.Errorf("check membership: %w", err)
	}
	if !isMember {
		return domain.ErrForbidden
	}
	return nil
}

func (uc *messageUseCase) CreateMessage(channelID, userID uuid.UUID, content string) (*domain.Message, error) {
	if err := uc.requireMembership(channelID, userID); err != nil {
		return nil, err
	}

	now := time.Now()
	msg := &domain.Message{
		ID:        uuid.New(),
		ChannelID: channelID,
		UserID:    userID,
		Content:   content,
		CreatedAt: now,
		UpdatedAt: now,
	}

	if err := uc.messageRepo.Create(msg); err != nil {
		return nil, fmt.Errorf("failed to create message: %w", err)
	}

	return msg, nil
}

func (uc *messageUseCase) GetMessages(channelID, userID uuid.UUID, limit, offset int) ([]*domain.Message, error) {
	if err := uc.requireMembership(channelID, userID); err != nil {
		return nil, err
	}

	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}

	messages, err := uc.messageRepo.GetByChannelID(channelID, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("failed to get messages: %w", err)
	}

	return messages, nil
}

func (uc *messageUseCase) UpdateMessage(channelID, messageID, userID uuid.UUID, content string) (*domain.Message, error) {
	if err := uc.requireMembership(channelID, userID); err != nil {
		return nil, err
	}

	msg, err := uc.messageRepo.GetByID(messageID)
	if err != nil {
		return nil, fmt.Errorf("get message: %w", err)
	}
	if msg.ChannelID != channelID {
		return nil, fmt.Errorf("message %s: %w", messageID, domain.ErrMessageNotFound)
	}
	if msg.UserID != userID {
		return nil, domain.ErrForbidden
	}

	if msg.Content == content {
		return msg, nil
	}

	if err := uc.messageRepo.Update(messageID, map[string]interface{}{"content": content}); err != nil {
		return nil, fmt.Errorf("failed to update message: %w", err)
	}

	msg.Content = content
	msg.UpdatedAt = time.Now()
	return msg, nil
}
