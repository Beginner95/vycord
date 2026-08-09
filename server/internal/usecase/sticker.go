package usecase

import (
	"bytes"
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/pkg/filestorage"
)

type stickerUseCase struct {
	stickerRepo domain.StickerRepository
	serverRepo  domain.ServerRepository
	perms       domain.PermissionUseCase
	storage     filestorage.Storage
}

func NewStickerUseCase(
	stickerRepo domain.StickerRepository,
	serverRepo domain.ServerRepository,
	perms domain.PermissionUseCase,
	storage filestorage.Storage,
) domain.StickerUseCase {
	return &stickerUseCase{stickerRepo: stickerRepo, serverRepo: serverRepo, perms: perms, storage: storage}
}

func (uc *stickerUseCase) requireManage(serverID, userID uuid.UUID) error {
	ps, err := uc.perms.Resolve(serverID, userID)
	if err != nil {
		return err
	}
	if !ps.Has(domain.PermManageServer) {
		return domain.ErrStickerForbidden
	}
	return nil
}

// validateStickerName проверяет имя: непустое, ≤100 символов.
func validateStickerName(name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return domain.ErrStickerNameRequired
	}
	if len([]rune(name)) > 100 {
		return domain.ErrStickerNameTooLong
	}
	return nil
}

func (uc *stickerUseCase) CreateSticker(serverID, userID uuid.UUID, name string, data []byte) (*domain.Sticker, error) {
	if _, err := uc.serverRepo.GetByID(serverID); err != nil {
		return nil, err
	}
	if err := uc.requireManage(serverID, userID); err != nil {
		return nil, err
	}
	if err := validateStickerName(name); err != nil {
		return nil, err
	}
	if len(data) == 0 {
		return nil, domain.ErrStickerImageRequired
	}

	ext, contentType, err := validateImage(data)
	if err != nil {
		return nil, err
	}

	key := fmt.Sprintf("stickers/%s/%s.%s", serverID, randomHex(8), ext)
	url, err := uc.storage.Save(context.Background(), key, bytes.NewReader(data), contentType)
	if err != nil {
		return nil, fmt.Errorf("save sticker: %w", err)
	}

	s := &domain.Sticker{
		ID:        uuid.New(),
		ServerID:  serverID,
		Name:      strings.TrimSpace(name),
		ImageURL:  url,
		CreatedBy: userID,
		CreatedAt: time.Now(),
	}
	if err := uc.stickerRepo.Create(s); err != nil {
		_ = uc.storage.Delete(context.Background(), url)
		return nil, err
	}
	return s, nil
}

func (uc *stickerUseCase) ListStickers(serverID, userID uuid.UUID) ([]*domain.Sticker, error) {
	// Чтение доступно участникам: не-участник получает нулевой набор прав от
	// Resolve. Для простоты требуем PermViewChannels.
	ps, err := uc.perms.Resolve(serverID, userID)
	if err != nil {
		return nil, err
	}
	if !ps.Has(domain.PermViewChannels) {
		return nil, domain.ErrStickerForbidden
	}
	return uc.stickerRepo.ListByServer(serverID)
}

func (uc *stickerUseCase) DeleteSticker(serverID, stickerID, userID uuid.UUID) error {
	if err := uc.requireManage(serverID, userID); err != nil {
		return err
	}
	s, err := uc.stickerRepo.GetByID(stickerID)
	if err != nil {
		return err
	}
	if s.ServerID != serverID {
		return domain.ErrStickerNotFound
	}
	if err := uc.stickerRepo.Delete(stickerID); err != nil {
		return err
	}
	_ = uc.storage.Delete(context.Background(), s.ImageURL)
	return nil
}