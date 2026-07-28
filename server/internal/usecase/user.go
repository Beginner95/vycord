package usecase

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/pkg/filestorage"
)


type userUseCase struct {
	userRepo domain.UserRepository
	storage  filestorage.Storage
}

func NewUserUseCase(userRepo domain.UserRepository, storage filestorage.Storage) domain.UserUseCase {
	return &userUseCase{userRepo: userRepo, storage: storage}
}

func (uc *userUseCase) GetByID(id uuid.UUID) (*domain.User, error) {
	user, err := uc.userRepo.GetByID(id)
	if err != nil {
		return nil, fmt.Errorf("failed to get user: %w", err)
	}

	// Clear password hash
	user.Password = ""
	return user, nil
}

func (uc *userUseCase) Search(query string, limit int) ([]*domain.User, error) {
	users, err := uc.userRepo.Search(query, limit, 0)
	if err != nil {
		return nil, fmt.Errorf("failed to search users: %w", err)
	}

	// Clear password hashes
	for _, user := range users {
		user.Password = ""
	}

	return users, nil
}

func (uc *userUseCase) UpdateStatus(id uuid.UUID, status domain.UserStatus) error {
	updates := map[string]interface{}{
		"status": status,
	}

	if err := uc.userRepo.Update(id, updates); err != nil {
		return fmt.Errorf("failed to update user status: %w", err)
	}

	return nil
}

func (uc *userUseCase) GetOnlineUserIDs() []uuid.UUID {
	// This is a stub - actual implementation gets online IDs from Hub
	return nil
}

func (uc *userUseCase) UpdateLastVisited(id uuid.UUID, serverID, channelID *uuid.UUID) error {
	if err := uc.userRepo.UpdateLastVisited(id, serverID, channelID); err != nil {
		return fmt.Errorf("failed to update last visited: %w", err)
	}
	return nil
}

func (uc *userUseCase) UpdateAvatar(id uuid.UUID, data []byte) (*domain.User, error) {
	ext, contentType, err := validateImage(data)
	if err != nil {
		return nil, err
	}

	user, err := uc.userRepo.GetByID(id)
	if err != nil {
		return nil, fmt.Errorf("get user: %w", err)
	}
	oldAvatarURL := user.AvatarURL

	key := fmt.Sprintf("avatars/%s/%s.%s", id, randomHex(8), ext)
	url, err := uc.storage.Save(context.Background(), key, bytes.NewReader(data), contentType)
	if err != nil {
		return nil, fmt.Errorf("save avatar: %w", err)
	}

	if err := uc.userRepo.Update(id, map[string]interface{}{"avatar_url": url}); err != nil {
		return nil, fmt.Errorf("update avatar url: %w", err)
	}

	if oldAvatarURL != nil {
		_ = uc.storage.Delete(context.Background(), *oldAvatarURL)
	}

	user.AvatarURL = &url
	user.Password = ""
	return user, nil
}

// RemoveAvatar clears the user's avatar_url and deletes the stored file. A
// no-op (not an error) if the user has no avatar set.
func (uc *userUseCase) RemoveAvatar(id uuid.UUID) (*domain.User, error) {
	user, err := uc.userRepo.GetByID(id)
	if err != nil {
		return nil, fmt.Errorf("get user: %w", err)
	}

	if user.AvatarURL == nil {
		user.Password = ""
		return user, nil
	}

	oldAvatarURL := *user.AvatarURL
	if err := uc.userRepo.Update(id, map[string]interface{}{"avatar_url": nil}); err != nil {
		return nil, fmt.Errorf("clear avatar url: %w", err)
	}
	_ = uc.storage.Delete(context.Background(), oldAvatarURL)

	user.AvatarURL = nil
	user.Password = ""
	return user, nil
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
