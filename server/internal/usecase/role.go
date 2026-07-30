package usecase

import (
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/domain"
)

type roleUseCase struct {
	serverRepo domain.ServerRepository
	roleRepo   domain.RoleRepository
	perms      domain.PermissionUseCase
}

func NewRoleUseCase(
	serverRepo domain.ServerRepository,
	roleRepo domain.RoleRepository,
	perms domain.PermissionUseCase,
) domain.RoleUseCase {
	return &roleUseCase{serverRepo: serverRepo, roleRepo: roleRepo, perms: perms}
}

// canGrant — актор не может выдать роли биты, которых у него нет самого.
// Владелец и носитель ADMINISTRATOR имеют все права эффективно, поэтому
// ограничение к ним неприменимо; их сдерживает иерархия (canManagePosition).
func canGrant(actor domain.PermissionSet, perms domain.Permission) bool {
	if actor.IsOwner || actor.Bits&domain.PermAdministrator != 0 {
		return true
	}
	return perms&^actor.Bits == 0
}

// canManagePosition — актор управляет только тем, что строго ниже его самой
// высокой роли. Неравенство строгое: иначе два носителя одной роли снимали бы
// права друг у друга. Владелец выше любой позиции.
func canManagePosition(actor domain.PermissionSet, position int) bool {
	if actor.IsOwner {
		return true
	}
	return position < actor.HighestPosition
}

// requireManageRoles резолвит права актора и требует MANAGE_ROLES.
func (uc *roleUseCase) requireManageRoles(serverID, actorID uuid.UUID) (domain.PermissionSet, error) {
	actor, err := uc.perms.Resolve(serverID, actorID)
	if err != nil {
		return domain.PermissionSet{}, err
	}
	if !actor.Has(domain.PermManageRoles) {
		return domain.PermissionSet{}, domain.ErrForbidden
	}
	return actor, nil
}

// validateRoleName нормализует и проверяет имя роли. Общий хелпер для
// CreateRole и UpdateRole: правило одно (1..100 символов после trim), и оно
// не должно разъезжаться между двумя точками входа.
func validateRoleName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 100 {
		return "", domain.ErrInvalidRoleName
	}
	return name, nil
}

// loadRole достаёт роль и проверяет, что она принадлежит серверу из URL.
// Роль чужого сервера маскируется под «не найдена», а не под 403.
func (uc *roleUseCase) loadRole(serverID, roleID uuid.UUID) (*domain.Role, error) {
	role, err := uc.roleRepo.GetByID(roleID)
	if err != nil {
		return nil, err
	}
	if role.ServerID != serverID {
		return nil, fmt.Errorf("role %s: %w", roleID, domain.ErrRoleNotFound)
	}
	return role, nil
}

func (uc *roleUseCase) ListRoles(serverID, userID uuid.UUID) ([]*domain.Role, error) {
	ps, err := uc.perms.Resolve(serverID, userID)
	if err != nil {
		return nil, err
	}
	if !ps.Has(domain.PermViewChannels) {
		return nil, domain.ErrForbidden
	}
	return uc.roleRepo.ListByServer(serverID)
}

func (uc *roleUseCase) CreateRole(serverID, actorID uuid.UUID, name string, color, position int, perms domain.Permission) (*domain.Role, error) {
	name, err := validateRoleName(name)
	if err != nil {
		return nil, err
	}
	if !perms.IsValid() {
		return nil, domain.ErrInvalidPermissions
	}
	// Позиция 0 зарезервирована за @everyone.
	if position < 1 {
		position = 1
	}

	actor, err := uc.requireManageRoles(serverID, actorID)
	if err != nil {
		return nil, err
	}
	if !canManagePosition(actor, position) || !canGrant(actor, perms) {
		return nil, domain.ErrForbidden
	}

	now := time.Now()
	role := &domain.Role{
		ID:          uuid.New(),
		ServerID:    serverID,
		Name:        name,
		Color:       color,
		Position:    position,
		Permissions: perms,
		IsDefault:   false,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := uc.roleRepo.Create(role); err != nil {
		return nil, fmt.Errorf("failed to create role: %w", err)
	}
	return role, nil
}

func (uc *roleUseCase) UpdateRole(serverID, roleID, actorID uuid.UUID, patch domain.RolePatch) (*domain.Role, error) {
	actor, err := uc.requireManageRoles(serverID, actorID)
	if err != nil {
		return nil, err
	}
	role, err := uc.loadRole(serverID, roleID)
	if err != nil {
		return nil, err
	}
	if !canManagePosition(actor, role.Position) {
		return nil, domain.ErrForbidden
	}

	updates := make(map[string]interface{})

	if patch.Name != nil {
		name, err := validateRoleName(*patch.Name)
		if err != nil {
			return nil, err
		}
		role.Name = name
		updates["name"] = name
	}
	if patch.Color != nil {
		role.Color = *patch.Color
		updates["color"] = *patch.Color
	}
	// Позиция @everyone всегда 0 и в патче игнорируется.
	if patch.Position != nil && !role.IsDefault {
		if !canManagePosition(actor, *patch.Position) {
			return nil, domain.ErrForbidden
		}
		pos := *patch.Position
		if pos < 1 {
			pos = 1
		}
		role.Position = pos
		updates["position"] = pos
	}
	if patch.Permissions != nil {
		if !patch.Permissions.IsValid() {
			return nil, domain.ErrInvalidPermissions
		}
		// Проверяем и новые биты, и снимаемые: нельзя отнять право, которого
		// у актора нет — иначе он ослаблял бы роли сильнее себя.
		changed := *patch.Permissions ^ role.Permissions
		if !canGrant(actor, changed) {
			return nil, domain.ErrForbidden
		}
		role.Permissions = *patch.Permissions
		updates["permissions"] = *patch.Permissions
	}

	if len(updates) == 0 {
		return role, nil
	}
	if err := uc.roleRepo.Update(roleID, updates); err != nil {
		return nil, fmt.Errorf("failed to update role: %w", err)
	}
	role.UpdatedAt = time.Now()
	return role, nil
}

func (uc *roleUseCase) DeleteRole(serverID, roleID, actorID uuid.UUID) error {
	actor, err := uc.requireManageRoles(serverID, actorID)
	if err != nil {
		return err
	}
	role, err := uc.loadRole(serverID, roleID)
	if err != nil {
		return err
	}
	// @everyone неудаляема: без неё участники остались бы без базовых прав.
	if role.IsDefault {
		return domain.ErrForbidden
	}
	if !canManagePosition(actor, role.Position) {
		return domain.ErrForbidden
	}
	if err := uc.roleRepo.Delete(roleID); err != nil {
		return fmt.Errorf("failed to delete role: %w", err)
	}
	return nil
}

// requireRoleAssignment — общие проверки для назначения и снятия роли.
// requireGrant включает проверку инварианта 1 (canGrant): она обязана
// применяться к AssignRole (назначение роли — это выдача её прав актором),
// но не к UnassignRole — иначе актор не смог бы снять роль, которую сам
// не мог бы выдать, что ломает обычную модерацию.
func (uc *roleUseCase) requireRoleAssignment(serverID, targetUserID, roleID, actorID uuid.UUID, requireGrant bool) (*domain.Role, error) {
	actor, err := uc.requireManageRoles(serverID, actorID)
	if err != nil {
		return nil, err
	}

	server, err := uc.serverRepo.GetByID(serverID)
	if err != nil {
		return nil, fmt.Errorf("server %s: %w", serverID, domain.ErrServerNotFound)
	}
	// Владелец вне досягаемости для чужих действий, включая носителей
	// ADMINISTRATOR. Себя самого владелец назначать/снимать может: его права
	// от ролей не зависят, самоназначение ничем не угрожает.
	if server.OwnerID == targetUserID && actorID != targetUserID {
		return nil, domain.ErrForbidden
	}

	role, err := uc.loadRole(serverID, roleID)
	if err != nil {
		return nil, err
	}
	// @everyone подразумевается для каждого участника и не назначается вручную.
	if role.IsDefault {
		return nil, domain.ErrForbidden
	}
	if !canManagePosition(actor, role.Position) {
		return nil, domain.ErrForbidden
	}
	// Инвариант 1: назначение роли выдаёт её права участнику, поэтому актор
	// не может назначить роль с битами, которых у него нет самого — иначе
	// он выдавал бы ADMINISTRATOR через роль ниже себя по иерархии.
	if requireGrant && !canGrant(actor, role.Permissions) {
		return nil, domain.ErrForbidden
	}

	target, err := uc.perms.Resolve(serverID, targetUserID)
	if err != nil {
		return nil, err
	}
	if !canManagePosition(actor, target.HighestPosition) {
		return nil, domain.ErrForbidden
	}

	return role, nil
}

func (uc *roleUseCase) AssignRole(serverID, targetUserID, roleID, actorID uuid.UUID) error {
	role, err := uc.requireRoleAssignment(serverID, targetUserID, roleID, actorID, true)
	if err != nil {
		return err
	}

	// Владелец самоназначения тоже обязан пройти проверку членства: он
	// забэкфиллен в server_members миграцией 009 для серверов, созданных до
	// неё, но CreateServer до сих пор не добавляет владельца в эту таблицу
	// для новых серверов (отдельный известный баг, не в рамках этой задачи).
	// Обход этой проверки для владельца ломал бы FK member_roles→server_members
	// и превращал бы честный 403 в 500 от нарушения ограничения.
	isMember, err := uc.serverRepo.IsMember(serverID, targetUserID)
	if err != nil {
		return fmt.Errorf("check membership: %w", err)
	}
	if !isMember {
		return domain.ErrForbidden
	}

	if err := uc.roleRepo.AssignToMember(serverID, targetUserID, role.ID); err != nil {
		return fmt.Errorf("failed to assign role: %w", err)
	}
	return nil
}

func (uc *roleUseCase) UnassignRole(serverID, targetUserID, roleID, actorID uuid.UUID) error {
	role, err := uc.requireRoleAssignment(serverID, targetUserID, roleID, actorID, false)
	if err != nil {
		return err
	}
	if err := uc.roleRepo.UnassignFromMember(serverID, targetUserID, role.ID); err != nil {
		return fmt.Errorf("failed to unassign role: %w", err)
	}
	return nil
}
