package usecase

import (
	"fmt"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/domain"
)

type userUseCase struct {
	userRepo domain.UserRepository
}

func NewUserUseCase(userRepo domain.UserRepository) domain.UserUseCase {
	return &userUseCase{userRepo: userRepo}
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
