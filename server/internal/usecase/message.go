package usecase

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/pkg/filestorage"
)

type messageUseCase struct {
	messageRepo domain.MessageRepository
	channelRepo domain.ChannelRepository
	serverRepo  domain.ServerRepository
	stickerRepo domain.StickerRepository
	perms       domain.PermissionUseCase
	attachRepo  domain.AttachmentRepository
	// storage нужен только на удалении: строки вложений уносит каскад, а
	// файлы после этого найти уже нечем — уборщик ищет по строкам в БД.
	storage filestorage.Storage
}

func NewMessageUseCase(
	messageRepo domain.MessageRepository,
	channelRepo domain.ChannelRepository,
	serverRepo domain.ServerRepository,
	stickerRepo domain.StickerRepository,
	perms domain.PermissionUseCase,
	attachRepo domain.AttachmentRepository,
	storage filestorage.Storage,
) domain.MessageUseCase {
	return &messageUseCase{
		messageRepo: messageRepo,
		channelRepo: channelRepo,
		serverRepo:  serverRepo,
		stickerRepo: stickerRepo,
		perms:       perms,
		attachRepo:  attachRepo,
		storage:     storage,
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

func (uc *messageUseCase) CreateMessage(channelID, userID uuid.UUID, content string, stickerID *uuid.UUID, attachmentIDs []uuid.UUID) (*domain.Message, error) {
	ch, err := uc.requirePermission(channelID, userID, domain.PermSendMessages)
	if err != nil {
		return nil, err
	}

	// Повтор id в attachment_ids — баг клиента, а не «уже отправлено».
	// AttachToMessage сверяет RowsAffected с len(ids); дубликат обновит одну
	// и ту же строку один раз, счётчики разойдутся, и наружу уйдёт
	// ErrAttachmentAlreadyAttached вместо внятной причины. Дедуп на входе
	// снимает этот случай, не трогая транзакционную логику привязки.
	attachmentIDs = dedupeAttachmentIDs(attachmentIDs)

	// Стикер — самостоятельный вид сообщения: ни текста, ни вложений с ним быть
	// не может. В хендлере эта проверка тоже есть, но правило принадлежит
	// бизнес-логике, а не транспорту.
	if stickerID != nil && len(attachmentIDs) > 0 {
		return nil, domain.ErrStickerWithAttachments
	}

	now := time.Now()
	msg := &domain.Message{
		ID:        uuid.New(),
		ChannelID: channelID,
		UserID:    userID,
		CreatedAt: now,
		UpdatedAt: now,
	}

	if stickerID == nil {
		// Сообщение валидно, если есть текст ИЛИ хотя бы одно вложение.
		if content == "" && len(attachmentIDs) == 0 {
			return nil, domain.ErrMessageEmpty
		}
		if content != "" {
			if err := uc.validateMentions(ch.ServerID, userID, content); err != nil {
				return nil, err
			}
		}
		msg.Content = content
	} else {
		// Сообщение-стикер: текста нет, но Content — непустая строка в смысле
		// NULL; кладём пустую строку (колонка content NOT NULL).
		msg.Content = ""

		// Стикер обязан существовать и принадлежать серверу канала.
		sticker, err := uc.stickerRepo.GetByID(*stickerID)
		if err != nil {
			return nil, err
		}
		if sticker.ServerID != ch.ServerID {
			return nil, domain.ErrStickerNotFound
		}
		msg.StickerID = stickerID
		msg.Sticker = sticker
	}

	if err := uc.messageRepo.Create(msg); err != nil {
		return nil, fmt.Errorf("failed to create message: %w", err)
	}

	if len(attachmentIDs) > 0 {
		// Привязка проверяет владельца, канал и то, что вложение свободно.
		// Если не прошло — сообщения быть не должно: пустая реплика вместо
		// картинки хуже, чем ошибка отправки.
		if err := uc.attachRepo.AttachToMessage(msg.ID, userID, channelID, attachmentIDs); err != nil {
			// Если и откат не удался, в канале останется висеть пустое
			// сообщение, а вызывающий будет думать, что не создалось ничего.
			// Логгера в usecase этого проекта нет ни у кого, поэтому
			// поднимаем обе ошибки наверх: хендлер запишет их в лог сам.
			if delErr := uc.messageRepo.Delete(msg.ID); delErr != nil {
				return nil, fmt.Errorf("%w (откат не удался: %v)", err, delErr)
			}
			return nil, err
		}
		atts, err := uc.attachRepo.ListByMessageIDs([]uuid.UUID{msg.ID})
		if err == nil {
			msg.Attachments = atts[msg.ID]
		}
	}

	return msg, nil
}

// dedupeAttachmentIDs убирает повторы, сохраняя порядок первого вхождения.
func dedupeAttachmentIDs(ids []uuid.UUID) []uuid.UUID {
	if len(ids) < 2 {
		return ids
	}
	seen := make(map[uuid.UUID]struct{}, len(ids))
	out := make([]uuid.UUID, 0, len(ids))
	for _, id := range ids {
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
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

	uc.attachToMessages(messages)
	return messages, nil
}

// attachToMessages подтягивает вложения для пачки сообщений одним запросом:
// иначе список из 50 сообщений дал бы 50 походов в БД.
func (uc *messageUseCase) attachToMessages(msgs []*domain.Message) {
	if len(msgs) == 0 {
		return
	}
	ids := make([]uuid.UUID, 0, len(msgs))
	for _, m := range msgs {
		ids = append(ids, m.ID)
	}
	byMsg, err := uc.attachRepo.ListByMessageIDs(ids)
	if err != nil {
		// Вложения — не критичная часть ответа: лучше отдать сообщения без
		// них, чем не отдать ничего.
		return
	}
	for _, m := range msgs {
		m.Attachments = byMsg[m.ID]
	}
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

	// MessageWithAuthor встраивает Message по значению — берём указатели на
	// вложенное поле, чтобы attachToMessages проставила Attachments прямо в
	// results, не копируя структуру.
	msgs := make([]*domain.Message, 0, len(results))
	for _, r := range results {
		msgs = append(msgs, &r.Message)
	}
	uc.attachToMessages(msgs)

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

	uc.attachToMessages(messages)
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
	// GetByID не заполняет Attachments — без этого поле уйдёт пустым, а
	// из-за omitempty ключа не будет вовсе в JSON: клиент, заменяющий
	// локальное сообщение пришедшим, потеряет картинки при каждой правке.
	uc.attachToMessages([]*domain.Message{msg})
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

	// Файлы вложений забираем ДО удаления сообщения: строки attachments
	// уносит ON DELETE CASCADE, и после него связь «сообщение → файл» уже
	// нигде не восстановить — файлы остались бы на диске навсегда.
	files := uc.attachmentFiles(messageID)

	if err := uc.messageRepo.Delete(messageID); err != nil {
		return fmt.Errorf("failed to delete message: %w", err)
	}

	uc.deleteFiles(files)
	return nil
}

// attachmentFiles собирает ключи хранилища всех вложений сообщения. Ошибку
// только логируем: не отдать пользователю удаление сообщения из-за проблем с
// уборкой файлов — хуже, чем оставить осиротевший файл.
func (uc *messageUseCase) attachmentFiles(messageID uuid.UUID) []string {
	byMessage, err := uc.attachRepo.ListByMessageIDs([]uuid.UUID{messageID})
	if err != nil {
		slog.Error("list attachments before message delete failed",
			"message_id", messageID, "error", err)
		return nil
	}

	var keys []string
	for _, a := range byMessage[messageID] {
		keys = append(keys, a.StorageKey)
		if a.ThumbKey != "" {
			keys = append(keys, a.ThumbKey)
		}
	}
	return keys
}

// deleteFiles удаляет файлы уже удалённого сообщения. Сообщения в БД больше
// нет, откатывать нечего — остаётся только сообщить о проблеме в лог.
func (uc *messageUseCase) deleteFiles(keys []string) {
	if len(keys) == 0 {
		return
	}
	ctx := context.Background()
	for _, key := range keys {
		if err := uc.storage.Delete(ctx, key); err != nil {
			slog.Error("delete attachment file after message delete failed",
				"key", key, "error", err)
		}
	}
}
