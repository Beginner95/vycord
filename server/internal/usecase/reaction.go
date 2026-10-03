package usecase

import (
	"fmt"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/domain"
)

type reactionUseCase struct {
	repo        domain.ReactionRepository
	messageRepo domain.MessageRepository
	channelRepo domain.ChannelRepository
	stickerRepo domain.StickerRepository
	perms       domain.PermissionUseCase
}

func NewReactionUseCase(
	repo domain.ReactionRepository,
	messageRepo domain.MessageRepository,
	channelRepo domain.ChannelRepository,
	stickerRepo domain.StickerRepository,
	perms domain.PermissionUseCase,
) domain.ReactionUseCase {
	return &reactionUseCase{repo: repo, messageRepo: messageRepo, channelRepo: channelRepo, stickerRepo: stickerRepo, perms: perms}
}

// target — общие проверки Add и Remove: ключ разбирается до любых походов в
// БД, право — то же, что у отправки сообщений, сообщение — из канала URL и
// не плашка звонка.
func (uc *reactionUseCase) target(userID, channelID, messageID uuid.UUID, rawKey string) (domain.ReactionKey, *domain.Channel, error) {
	key, err := domain.ParseReactionKey(rawKey)
	if err != nil {
		return key, nil, err
	}
	ch, err := uc.channelRepo.GetByID(channelID)
	if err != nil {
		return key, nil, fmt.Errorf("get channel: %w", err)
	}
	ps, err := uc.perms.Resolve(ch.ServerID, userID)
	if err != nil {
		return key, nil, err
	}
	if !ps.Has(domain.PermSendMessages) {
		return key, nil, domain.ErrForbidden
	}
	msg, err := uc.messageRepo.GetByID(messageID)
	if err != nil {
		return key, nil, fmt.Errorf("get message: %w", err)
	}
	if msg.ChannelID != channelID {
		return key, nil, fmt.Errorf("message %s: %w", messageID, domain.ErrMessageNotFound)
	}
	if msg.Kind == "call" {
		return key, nil, domain.ErrReactionNotAllowed
	}
	return key, ch, nil
}

func (uc *reactionUseCase) Add(userID, channelID, messageID uuid.UUID, rawKey string) ([]domain.Reaction, error) {
	key, ch, err := uc.target(userID, channelID, messageID, rawKey)
	if err != nil {
		return nil, err
	}
	if key.StickerID != nil {
		s, err := uc.stickerRepo.GetByID(*key.StickerID)
		if err != nil {
			return nil, err
		}
		// Стикер чужого сервера — то же, что несуществующий.
		if s.ServerID != ch.ServerID {
			return nil, fmt.Errorf("sticker %s: %w", s.ID, domain.ErrStickerNotFound)
		}
	}
	return uc.repo.Add(messageID, userID, key, domain.MaxDistinctReactions)
}

func (uc *reactionUseCase) Remove(userID, channelID, messageID uuid.UUID, rawKey string) ([]domain.Reaction, error) {
	key, _, err := uc.target(userID, channelID, messageID, rawKey)
	if err != nil {
		return nil, err
	}
	return uc.repo.Remove(messageID, userID, key)
}
