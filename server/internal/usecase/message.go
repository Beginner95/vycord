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
	perms       domain.PermissionUseCase
}

func NewMessageUseCase(
	messageRepo domain.MessageRepository,
	channelRepo domain.ChannelRepository,
	serverRepo domain.ServerRepository,
	perms domain.PermissionUseCase,
) domain.MessageUseCase {
	return &messageUseCase{
		messageRepo: messageRepo,
		channelRepo: channelRepo,
		serverRepo:  serverRepo,
		perms:       perms,
	}
}

// requirePermission проверяет, что канал существует и у пользователя есть право
// perm на его сервере. Возвращает сам канал — вызывающему нужен serverID
// без повторного запроса. Приватность канала не проверяется — её больше не
// существует, вся приватность теперь на уровне сервера и уже обеспечена тем,
// что perms.Resolve отдаёт не-участнику нулевой набор прав.
func (uc *messageUseCase) requirePermission(channelID, userID uuid.UUID, perm domain.Permission) (*domain.Channel, error) {
	ch, err := uc.channelRepo.GetByID(channelID)
	if err != nil {
		return nil, fmt.Errorf("get channel: %w", err)
	}

	ps, err := uc.perms.Resolve(ch.ServerID, userID)
	if err != nil {
		return nil, err
	}
	if !ps.Has(perm) {
		return nil, domain.ErrForbidden
	}

	return ch, nil
}

// validateMentions проверяет, что все упомянутые через <@uuid> пользователи
// состоят в сервере, а @everyone доступен только при праве MENTION_EVERYONE.
func (uc *messageUseCase) validateMentions(serverID, authorID uuid.UUID, content string) error {
	m := parseMentions(content)

	for _, uid := range m.userIDs {
		isMember, err := uc.serverRepo.IsMember(serverID, uid)
		if err != nil {
			return fmt.Errorf("check mention membership: %w", err)
		}
		if !isMember {
			return fmt.Errorf("mention %s: %w", uid, domain.ErrInvalidMention)
		}
	}

	if m.everyone {
		ps, err := uc.perms.Resolve(serverID, authorID)
		if err != nil {
			return fmt.Errorf("resolve author permissions: %w", err)
		}
		if !ps.Has(domain.PermMentionEveryone) {
			return domain.ErrMentionForbidden
		}
	}

	return nil
}

func (uc *messageUseCase) CreateMessage(channelID, userID uuid.UUID, content string) (*domain.Message, error) {
	ch, err := uc.requirePermission(channelID, userID, domain.PermSendMessages)
	if err != nil {
		return nil, err
	}
	if err := uc.validateMentions(ch.ServerID, userID, content); err != nil {
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
	if _, err := uc.requirePermission(channelID, userID, domain.PermViewChannels); err != nil {
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

func normalizeSearchLimit(limit int) int {
	if limit <= 0 {
		return 25
	}
	if limit > 50 {
		return 50
	}
	return limit
}

func (uc *messageUseCase) SearchMessages(channelID, userID uuid.UUID, query string, limit, offset int) ([]*domain.MessageWithAuthor, int, error) {
	if _, err := uc.requirePermission(channelID, userID, domain.PermViewChannels); err != nil {
		return nil, 0, err
	}

	results, total, err := uc.messageRepo.Search(channelID, query, normalizeSearchLimit(limit), offset)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to search messages: %w", err)
	}
	return results, total, nil
}

func (uc *messageUseCase) GetMessagesAround(channelID, messageID, userID uuid.UUID, limit int) ([]*domain.Message, error) {
	if _, err := uc.requirePermission(channelID, userID, domain.PermViewChannels); err != nil {
		return nil, err
	}

	messages, err := uc.messageRepo.GetAround(channelID, messageID, normalizeSearchLimit(limit))
	if err != nil {
		return nil, fmt.Errorf("failed to get messages around: %w", err)
	}
	return messages, nil
}

func (uc *messageUseCase) UpdateMessage(channelID, messageID, userID uuid.UUID, content string) (*domain.Message, error) {
	ch, err := uc.requirePermission(channelID, userID, domain.PermSendMessages)
	if err != nil {
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

	if err := uc.validateMentions(ch.ServerID, userID, content); err != nil {
		return nil, err
	}

	if err := uc.messageRepo.Update(messageID, map[string]interface{}{"content": content}); err != nil {
		return nil, fmt.Errorf("failed to update message: %w", err)
	}

	msg.Content = content
	msg.UpdatedAt = time.Now()
	return msg, nil
}

func (uc *messageUseCase) DeleteMessage(channelID, messageID, userID uuid.UUID) error {
	if _, err := uc.requirePermission(channelID, userID, domain.PermSendMessages); err != nil {
		return err
	}

	msg, err := uc.messageRepo.GetByID(messageID)
	if err != nil {
		return fmt.Errorf("get message: %w", err)
	}
	if msg.ChannelID != channelID {
		return fmt.Errorf("message %s: %w", messageID, domain.ErrMessageNotFound)
	}
	if msg.UserID != userID {
		return domain.ErrForbidden
	}

	if err := uc.messageRepo.Delete(messageID); err != nil {
		return fmt.Errorf("failed to delete message: %w", err)
	}
	return nil
}
