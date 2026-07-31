package usecase

import (
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/domain"
)

type permissionUseCase struct {
	serverRepo domain.ServerRepository
	roleRepo   domain.RoleRepository
}

func NewPermissionUseCase(serverRepo domain.ServerRepository, roleRepo domain.RoleRepository) domain.PermissionUseCase {
	return &permissionUseCase{serverRepo: serverRepo, roleRepo: roleRepo}
}

// Resolve возвращает эффективные права пользователя на сервере.
//
// Порядок намеренный: владелец определяется до обращения к ролям и
// короткозамыкает PermissionSet.Has(), поэтому его нельзя ограничить ролью,
// лишить прав редактированием роли или отрезать удалением роли.
// Не-участник получает нулевой набор, а не ошибку: вызывающий сам решает,
// вернуть 403 или пустой ответ.
func (uc *permissionUseCase) Resolve(serverID, userID uuid.UUID) (domain.PermissionSet, error) {
	// Репозиторий уже различает "сервера нет" (domain.ErrServerNotFound) и
	// сбой самой БД: первое пробрасываем как есть, второе — обёрнутым, чтобы
	// наружу ушёл 500, а не ложный 404 "сервер не найден" на каждый запрос
	// при падении Postgres (тот же класс инцидента, что VYC-54 с auth-мидлварью).
	server, err := uc.serverRepo.GetByID(serverID)
	if err != nil {
		if errors.Is(err, domain.ErrServerNotFound) {
			return domain.PermissionSet{}, err
		}
		return domain.PermissionSet{}, fmt.Errorf("get server: %w", err)
	}

	if server.OwnerID != userID {
		isMember, err := uc.serverRepo.IsMember(serverID, userID)
		if err != nil {
			return domain.PermissionSet{}, fmt.Errorf("check membership: %w", err)
		}
		if !isMember {
			return domain.PermissionSet{HighestPosition: -1}, nil
		}
	}

	bits, position, err := uc.roleRepo.ResolveMemberPermissions(serverID, userID)
	if err != nil {
		return domain.PermissionSet{}, fmt.Errorf("resolve permissions: %w", err)
	}

	return domain.PermissionSet{
		IsOwner:         server.OwnerID == userID,
		Bits:            bits,
		HighestPosition: position,
	}, nil
}
