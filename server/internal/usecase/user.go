package usecase

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/pkg/filestorage"
	"github.com/vycord/server/pkg/phonecrypto"
)

type userUseCase struct {
	userRepo domain.UserRepository
	storage  filestorage.Storage
	// phoneKey — PHONE_ENC_KEY (32 байта), шифрование номеров (VYC-97).
	phoneKey []byte
}

func NewUserUseCase(userRepo domain.UserRepository, storage filestorage.Storage, phoneKey []byte) domain.UserUseCase {
	return &userUseCase{userRepo: userRepo, storage: storage, phoneKey: phoneKey}
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

// GetMe — как GetByID, но с PhoneMasked: расшифровывает phone_cipher и
// строит маску. Только для ответов «про себя».
func (uc *userUseCase) GetMe(id uuid.UUID) (*domain.User, error) {
	return uc.getMe(id)
}

func (uc *userUseCase) getMe(id uuid.UUID) (*domain.User, error) {
	user, err := uc.userRepo.GetByID(id)
	if err != nil {
		return nil, fmt.Errorf("failed to get user: %w", err)
	}
	user.Password = ""
	if user.PhoneCipher != nil {
		plain, err := phonecrypto.Decrypt(uc.phoneKey, *user.PhoneCipher)
		if err != nil {
			return nil, fmt.Errorf("decrypt phone: %w", err)
		}
		mask := phonecrypto.Mask(plain)
		user.PhoneMasked = &mask
	}
	return user, nil
}

// SetPhone — нормализация → индекс+шифротекст → сохранение → «про себя» с
// маской. Единственная точка, где открытый номер попадает в хранилище
// (только в зашифрованном виде).
func (uc *userUseCase) SetPhone(id uuid.UUID, raw string) (*domain.User, error) {
	normalized, err := phonecrypto.Normalize(raw)
	if err != nil {
		return nil, domain.ErrInvalidPhone
	}
	index, err := phonecrypto.Index(uc.phoneKey, normalized)
	if err != nil {
		return nil, fmt.Errorf("phone index: %w", err)
	}
	cipher, err := phonecrypto.Encrypt(uc.phoneKey, normalized)
	if err != nil {
		return nil, fmt.Errorf("encrypt phone: %w", err)
	}
	if err := uc.userRepo.SetPhone(id, index, cipher); err != nil {
		return nil, err
	}
	return uc.getMe(id)
}

// ClearPhone снимает номер (освобождает его для других).
func (uc *userUseCase) ClearPhone(id uuid.UUID) (*domain.User, error) {
	if err := uc.userRepo.ClearPhone(id); err != nil {
		return nil, fmt.Errorf("clear phone: %w", err)
	}
	return uc.getMe(id)
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

const maxLastSeenBatch = 200

func (uc *userUseCase) UpdateLastSeen(id uuid.UUID, at time.Time) error {
	if err := uc.userRepo.UpdateLastSeen(id, at); err != nil {
		return fmt.Errorf("failed to update last seen: %w", err)
	}
	return nil
}

// GetLastSeenBatch only applies an abuse-prevention size cap; privacy is
// already unwrapped by the repository (LastSeenInfo.Visible), so this layer
// doesn't re-check it — the rule "visible=false ⇒ last_seen_at=nil" lives in
// exactly one place.
func (uc *userUseCase) GetLastSeenBatch(ids []uuid.UUID) (map[uuid.UUID]domain.LastSeenInfo, error) {
	if len(ids) == 0 {
		return map[uuid.UUID]domain.LastSeenInfo{}, nil
	}
	if len(ids) > maxLastSeenBatch {
		return nil, domain.ErrLastSeenBatchTooLarge
	}
	return uc.userRepo.GetLastSeenBatch(ids)
}

func (uc *userUseCase) SetPrivacy(id uuid.UUID, showLastSeen *bool, friendRequests, dmFrom *domain.PrivacyMode, allowSearchByPhone *bool) error {
	if friendRequests != nil && !friendRequests.ValidForFriendRequests() {
		return domain.ErrInvalidPrivacyMode
	}
	if dmFrom != nil && !dmFrom.ValidForDM() {
		return domain.ErrInvalidPrivacyMode
	}
	return uc.userRepo.UpdatePrivacy(id, showLastSeen, friendRequests, dmFrom, allowSearchByPhone)
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
