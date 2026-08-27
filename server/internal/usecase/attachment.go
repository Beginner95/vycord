package usecase

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/pkg/filename"
	"github.com/vycord/server/pkg/filestorage"
)

// sniffSize — сколько байт читаем для определения типа. 512 — ровно столько
// смотрит http.DetectContentType.
const sniffSize = 512

type attachmentUseCase struct {
	repo    domain.AttachmentRepository
	chRepo  domain.ChannelRepository
	perms   domain.PermissionUseCase
	quota   domain.QuotaUseCase
	storage filestorage.Storage
}

func NewAttachmentUseCase(
	repo domain.AttachmentRepository,
	chRepo domain.ChannelRepository,
	perms domain.PermissionUseCase,
	quota domain.QuotaUseCase,
	storage filestorage.Storage,
) domain.AttachmentUseCase {
	return &attachmentUseCase{repo: repo, chRepo: chRepo, perms: perms, quota: quota, storage: storage}
}

// requirePermission повторяет приём messageUseCase: канал существует и у
// пользователя есть нужное право на его сервере.
func (uc *attachmentUseCase) requirePermission(channelID, userID uuid.UUID, perm domain.Permission) (*domain.Channel, error) {
	ch, err := uc.chRepo.GetByID(channelID)
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

func (uc *attachmentUseCase) Upload(in domain.AttachmentUpload) (*domain.Attachment, error) {
	if _, err := uc.requirePermission(in.ChannelID, in.UserID, domain.PermSendMessages); err != nil {
		return nil, err
	}

	// Лимит — только через QuotaUseCase: никаких констант размера здесь.
	if err := uc.quota.CheckUpload(in.UserID, in.Size); err != nil {
		return nil, err
	}

	head := make([]byte, sniffSize)
	n, err := io.ReadFull(in.Content, head)
	if err != nil && err != io.ErrUnexpectedEOF && err != io.EOF {
		return nil, fmt.Errorf("read file head: %w", err)
	}
	head = head[:n]

	safeName := filename.Sanitize(in.FileName)
	kind, contentType := DetectKind(head, safeName)

	id := uuid.New()
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(safeName), "."))
	if ext == "" {
		// Иначе ключ оканчивается висящей точкой: "…/<uuid>."
		ext = "bin"
	}
	att := &domain.Attachment{
		ID:          id,
		UserID:      in.UserID,
		ChannelID:   in.ChannelID,
		Kind:        kind,
		FileName:    safeName,
		ContentType: contentType,
		SizeBytes:   in.Size,
		// Имя на диске — UUID: исходное имя не участвует в пути, поэтому ни
		// коллизий, ни обхода каталога быть не может.
		StorageKey: fmt.Sprintf("attachments/%s/%s.%s", in.ChannelID, id, ext),
		CreatedAt:  time.Now(),
	}

	// Для картинок получаем размеры и миниатюру.
	var thumb *ImageMeta
	if kind == domain.AttachmentKindImage {
		meta, ok := AnalyzeImage(in.Content)
		switch {
		case ok:
			att.Width, att.Height = &meta.Width, &meta.Height
			if meta.Thumb != nil {
				thumb = meta
				att.ThumbKey = fmt.Sprintf("attachments/%s/%s_thumb.%s", in.ChannelID, id, meta.ThumbExt)
			}
		case DecodableImage(contentType):
			// Декодер для этого типа есть, а файл им не разобрался: он битый
			// либо слишком велик по площади. Понижаем до файла — та же
			// политика, что и в DetectKind для неопознанного содержимого.
			att.Kind = domain.AttachmentKindFile
			att.ContentType = "application/octet-stream"
		default:
			// AVIF/HEIC: тип надёжно опознан по сигнатуре контейнера, но
			// декодера без cgo для него нет. Оставляем картинкой без размеров
			// и миниатюры — /thumb отдаст оригинал, лента покажет его как есть.
		}
	}

	expiresAt, err := uc.quota.ExpiresAt(in.UserID, att.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("resolve retention: %w", err)
	}
	att.ExpiresAt = expiresAt

	ctx := context.Background()
	if _, err := in.Content.Seek(0, io.SeekStart); err != nil {
		return nil, fmt.Errorf("rewind file: %w", err)
	}
	if _, err := uc.storage.Save(ctx, att.StorageKey, in.Content, att.ContentType); err != nil {
		return nil, fmt.Errorf("save attachment: %w", err)
	}

	if thumb != nil {
		if _, err := uc.storage.Save(ctx, att.ThumbKey, bytes.NewReader(thumb.Thumb), thumb.ThumbContentType); err != nil {
			// Миниатюра — оптимизация, а не обязательная часть: без неё в
			// ленте покажется оригинал. Ронять из-за неё загрузку не за что.
			att.ThumbKey = ""
		}
	}

	if err := uc.repo.Create(att); err != nil {
		// Файл без строки в БД никому не доступен и не будет убран уборщиком —
		// удаляем сразу, тем же приёмом, что и CreateSticker.
		_ = uc.storage.Delete(ctx, att.StorageKey)
		if att.ThumbKey != "" {
			_ = uc.storage.Delete(ctx, att.ThumbKey)
		}
		return nil, fmt.Errorf("create attachment: %w", err)
	}

	return att, nil
}

func (uc *attachmentUseCase) GetForUser(id, userID uuid.UUID) (*domain.Attachment, error) {
	att, err := uc.repo.GetByID(id)
	if err != nil {
		return nil, err
	}
	// Право на просмотр канала, а не владение вложением: файл видят все
	// участники канала. Отсутствие права отдаём как «не найдено», чтобы не
	// подтверждать существование вложения постороннему.
	if _, err := uc.requirePermission(att.ChannelID, userID, domain.PermViewChannels); err != nil {
		return nil, domain.ErrAttachmentNotFound
	}
	return att, nil
}

func (uc *attachmentUseCase) OpenContent(id uuid.UUID) (*domain.Attachment, io.ReadSeekCloser, error) {
	att, err := uc.repo.GetByID(id)
	if err != nil {
		return nil, nil, err
	}
	f, err := uc.storage.Open(context.Background(), att.StorageKey)
	if err != nil {
		return nil, nil, fmt.Errorf("open attachment: %w", err)
	}
	return att, f, nil
}

// OpenThumb отдаёт миниатюру, а если её нет — оригинал: клиенту не нужно
// знать, сумели мы сделать превью или нет (WebP и AVIF stdlib не декодирует).
//
// Фолбэк допустим ТОЛЬКО для картинок. Подпись ссылки покрывает id и срок, но
// не путь, поэтому ссылку на /content можно предъявить и на /thumb. Без этой
// проверки любой не-медиа файл — например HTML — отдавался бы через /thumb в
// обход принудительного octet-stream и выполнялся бы как страница на домене API.
func (uc *attachmentUseCase) OpenThumb(id uuid.UUID) (*domain.Attachment, io.ReadSeekCloser, error) {
	att, err := uc.repo.GetByID(id)
	if err != nil {
		return nil, nil, err
	}
	if att.Kind != domain.AttachmentKindImage {
		return nil, nil, domain.ErrAttachmentNotFound
	}
	key := att.ThumbKey
	if key == "" {
		key = att.StorageKey
	}
	f, err := uc.storage.Open(context.Background(), key)
	if err != nil {
		return nil, nil, fmt.Errorf("open thumbnail: %w", err)
	}
	return att, f, nil
}

func (uc *attachmentUseCase) Delete(id, userID uuid.UUID) error {
	att, err := uc.repo.GetByID(id)
	if err != nil {
		return err
	}
	if att.UserID != userID {
		return domain.ErrAttachmentNotFound
	}
	// Удаление черновика не должно вырезать файл из уже отправленного
	// сообщения: там за удаление отвечает удаление самого сообщения.
	if att.MessageID != nil {
		return domain.ErrAttachmentAlreadyAttached
	}

	if err := uc.repo.Delete(id); err != nil {
		return fmt.Errorf("delete attachment: %w", err)
	}

	ctx := context.Background()
	_ = uc.storage.Delete(ctx, att.StorageKey)
	if att.ThumbKey != "" {
		_ = uc.storage.Delete(ctx, att.ThumbKey)
	}
	return nil
}
