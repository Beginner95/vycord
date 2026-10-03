package usecase

import (
	"fmt"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/domain"
)

type readStateUseCase struct {
	repo        domain.ReadStateRepository
	messageRepo domain.MessageRepository
	channelRepo domain.ChannelRepository
	perms       domain.PermissionUseCase
}

func NewReadStateUseCase(
	repo domain.ReadStateRepository,
	messageRepo domain.MessageRepository,
	channelRepo domain.ChannelRepository,
	perms domain.PermissionUseCase,
) domain.ReadStateUseCase {
	return &readStateUseCase{repo: repo, messageRepo: messageRepo, channelRepo: channelRepo, perms: perms}
}

// viewable — канал и права пользователя на его сервере. Курсор и квитанции —
// то же чтение канала, что и лента: нужен PermViewChannels.
func (uc *readStateUseCase) viewable(userID, channelID uuid.UUID) (*domain.Channel, domain.PermissionSet, error) {
	ch, err := uc.channelRepo.GetByID(channelID)
	if err != nil {
		return nil, domain.PermissionSet{}, fmt.Errorf("get channel: %w", err)
	}
	ps, err := uc.perms.Resolve(ch.ServerID, userID)
	if err != nil {
		return nil, ps, err
	}
	if !ps.Has(domain.PermViewChannels) {
		return nil, ps, domain.ErrForbidden
	}
	return ch, ps, nil
}

// messageIn — сообщение, принадлежащее каналу из URL. Чужой канал — то же,
// что несуществующее сообщение: курсор нельзя поставить на сообщение
// другого канала.
func (uc *readStateUseCase) messageIn(channelID, messageID uuid.UUID) (*domain.Message, error) {
	msg, err := uc.messageRepo.GetByID(messageID)
	if err != nil {
		return nil, err
	}
	if msg.ChannelID != channelID {
		return nil, fmt.Errorf("message %s: %w", messageID, domain.ErrMessageNotFound)
	}
	return msg, nil
}

func (uc *readStateUseCase) Unread(userID uuid.UUID) ([]*domain.ChannelUnread, error) {
	return uc.repo.ListUnread(userID)
}

func (uc *readStateUseCase) MarkRead(userID, channelID, messageID uuid.UUID) (*domain.MarkReadResult, error) {
	ch, _, err := uc.viewable(userID, channelID)
	if err != nil {
		return nil, err
	}
	msg, err := uc.messageIn(channelID, messageID)
	if err != nil {
		return nil, err
	}
	advanced, err := uc.repo.Advance(userID, channelID, msg.CreatedAt, msg.ID)
	if err != nil {
		return nil, err
	}
	cur, err := uc.repo.Cursor(userID, channelID)
	if err != nil {
		return nil, err
	}
	count, err := uc.repo.CountUnread(userID, channelID)
	if err != nil {
		return nil, err
	}
	return &domain.MarkReadResult{ServerID: ch.ServerID, Count: count, ReadCursor: *cur, Advanced: advanced}, nil
}

func (uc *readStateUseCase) OthersRead(userID, channelID uuid.UUID) (*domain.ReadCursor, error) {
	if _, _, err := uc.viewable(userID, channelID); err != nil {
		return nil, err
	}
	return uc.repo.OthersMax(userID, channelID)
}

func (uc *readStateUseCase) Readers(userID, channelID, messageID uuid.UUID) (*domain.MessageReaders, error) {
	ch, ps, err := uc.viewable(userID, channelID)
	if err != nil {
		return nil, err
	}
	msg, err := uc.messageIn(channelID, messageID)
	if err != nil {
		return nil, err
	}
	// Квитанций нет у call-плашек и у гостевых сообщений: у гостя нет
	// аккаунта, которому их показывать.
	if msg.Kind != "user" || msg.UserID == nil {
		return nil, domain.ErrForbidden
	}
	// PermissionSet.Has короткозамыкает владельца и PermAdministrator.
	if !msg.IsAuthoredBy(userID) && !ps.Has(domain.PermAdministrator) {
		return nil, domain.ErrForbidden
	}
	list, err := uc.repo.Readers(ch.ServerID, channelID, msg.CreatedAt, msg.ID, *msg.UserID)
	if err != nil {
		return nil, err
	}
	res := &domain.MessageReaders{Read: []*domain.Reader{}, Unread: []*domain.Reader{}}
	for _, r := range list {
		if r.HasRead {
			res.Read = append(res.Read, r)
		} else {
			res.Unread = append(res.Unread, r)
		}
	}
	return res, nil
}

func (uc *readStateUseCase) AuthorRead(msg *domain.Message) error {
	if msg.Kind != "user" || msg.UserID == nil {
		return nil
	}
	_, err := uc.repo.Advance(*msg.UserID, msg.ChannelID, msg.CreatedAt, msg.ID)
	return err
}

func (uc *readStateUseCase) MessageByID(id uuid.UUID) (*domain.Message, error) {
	return uc.messageRepo.GetByID(id)
}

func (uc *readStateUseCase) Activity(msg *domain.Message, op string) (*domain.ChannelActivity, []uuid.UUID, error) {
	if msg.Kind != "user" {
		return nil, nil, nil
	}
	ch, err := uc.channelRepo.GetByID(msg.ChannelID)
	if err != nil {
		return nil, nil, fmt.Errorf("get channel: %w", err)
	}
	ids, err := uc.repo.ServerMemberIDs(ch.ServerID)
	if err != nil {
		return nil, nil, err
	}
	return &domain.ChannelActivity{
		Op: op, ServerID: ch.ServerID, ChannelID: msg.ChannelID, MessageID: msg.ID,
		CreatedAt: msg.CreatedAt, AuthorUserID: msg.UserID,
	}, ids, nil
}
