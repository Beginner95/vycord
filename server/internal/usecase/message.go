package usecase

import (
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/domain"
)

type messageUseCase struct {
	messageRepo   domain.MessageRepository
	channelRepo   domain.ChannelRepository
}

func NewMessageUseCase(
	messageRepo domain.MessageRepository,
	channelRepo domain.ChannelRepository,
) domain.MessageUseCase {
	return &messageUseCase{
		messageRepo: messageRepo,
		channelRepo: channelRepo,
	}
}

func (uc *messageUseCase) CreateMessage(channelID, userID uuid.UUID, content string) (*domain.Message, error) {
	// Verify channel exists
	_, err := uc.channelRepo.GetByID(channelID)
	if err != nil {
		return nil, fmt.Errorf("channel not found: %w", err)
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

func (uc *messageUseCase) GetMessages(channelID uuid.UUID, limit, offset int) ([]*domain.Message, error) {
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
