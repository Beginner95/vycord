package usecase

import (
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/domain"
)

type inviteUseCase struct {
	inviteRepo domain.InviteRepository
	serverRepo domain.ServerRepository
	perms      domain.PermissionUseCase
}

func NewInviteUseCase(inviteRepo domain.InviteRepository, serverRepo domain.ServerRepository, perms domain.PermissionUseCase) domain.InviteUseCase {
	return &inviteUseCase{inviteRepo: inviteRepo, serverRepo: serverRepo, perms: perms}
}

func (uc *inviteUseCase) CreateInvite(serverID, userID uuid.UUID) (*domain.Invite, error) {
	ps, err := uc.perms.Resolve(serverID, userID)
	if err != nil {
		return nil, err
	}
	if !ps.Has(domain.PermCreateInvite) {
		return nil, domain.ErrInviteForbidden
	}

	invite := &domain.Invite{
		ServerID:  serverID,
		CreatedBy: userID,
		CreatedAt: time.Now(),
	}
	if err := uc.inviteRepo.Create(invite); err != nil {
		return nil, fmt.Errorf("failed to create invite: %w", err)
	}
	return invite, nil
}

func (uc *inviteUseCase) ListInvites(serverID, userID uuid.UUID) ([]*domain.Invite, error) {
	ps, err := uc.perms.Resolve(serverID, userID)
	if err != nil {
		return nil, err
	}
	if !ps.Has(domain.PermCreateInvite) && !ps.Has(domain.PermManageServer) {
		return nil, domain.ErrInviteForbidden
	}

	invites, err := uc.inviteRepo.ListByServer(serverID)
	if err != nil {
		return nil, fmt.Errorf("failed to list invites: %w", err)
	}
	if ps.Has(domain.PermManageServer) {
		return invites, nil
	}

	own := make([]*domain.Invite, 0, len(invites))
	for _, inv := range invites {
		if inv.CreatedBy == userID {
			own = append(own, inv)
		}
	}
	return own, nil
}

func (uc *inviteUseCase) RevokeInvite(serverID uuid.UUID, code string, userID uuid.UUID) error {
	invite, err := uc.inviteRepo.GetByCode(code)
	if err != nil {
		return err
	}
	if invite.ServerID != serverID {
		return domain.ErrInviteNotFound
	}

	ps, err := uc.perms.Resolve(serverID, userID)
	if err != nil {
		return err
	}
	if invite.CreatedBy != userID && !ps.Has(domain.PermManageServer) {
		return domain.ErrInviteForbidden
	}

	return uc.inviteRepo.Delete(code)
}

// checkInviteValid проверяет срок действия и лимит использований — общая
// часть PreviewInvite и JoinViaInvite. NULL-поля (форма создания их не
// выставляет в v1) означают «без ограничения».
func checkInviteValid(invite *domain.Invite) error {
	if invite.ExpiresAt != nil && time.Now().After(*invite.ExpiresAt) {
		return domain.ErrInviteNotFound
	}
	if invite.MaxUses != nil && invite.Uses >= *invite.MaxUses {
		return domain.ErrInviteNotFound
	}
	return nil
}

func (uc *inviteUseCase) PreviewInvite(code string) (*domain.InvitePreview, error) {
	invite, err := uc.inviteRepo.GetByCode(code)
	if err != nil {
		return nil, err
	}
	if err := checkInviteValid(invite); err != nil {
		return nil, err
	}

	server, err := uc.serverRepo.GetByID(invite.ServerID)
	if err != nil {
		return nil, fmt.Errorf("get server: %w", err)
	}
	members, err := uc.serverRepo.GetMembersWithUsers(invite.ServerID)
	if err != nil {
		return nil, fmt.Errorf("get server members: %w", err)
	}

	return &domain.InvitePreview{
		ServerID:    server.ID,
		ServerName:  server.Name,
		IconURL:     server.IconURL,
		MemberCount: len(members),
	}, nil
}

// JoinViaInvite идемпотентен: владелец или уже вступивший участник просто
// получает сервер обратно, без повторного добавления и без инкремента
// счётчика — переход по уже использованной лично тобой ссылке не должен
// ни падать, ни расходовать чужой лимит использований.
func (uc *inviteUseCase) JoinViaInvite(code string, userID uuid.UUID) (*domain.Server, error) {
	invite, err := uc.inviteRepo.GetByCode(code)
	if err != nil {
		return nil, err
	}
	if err := checkInviteValid(invite); err != nil {
		return nil, err
	}

	server, err := uc.serverRepo.GetByID(invite.ServerID)
	if err != nil {
		return nil, fmt.Errorf("get server: %w", err)
	}

	if server.OwnerID == userID {
		return server, nil
	}
	isMember, err := uc.serverRepo.IsMember(invite.ServerID, userID)
	if err != nil {
		return nil, fmt.Errorf("check membership: %w", err)
	}
	if isMember {
		return server, nil
	}

	if err := uc.serverRepo.AddMember(invite.ServerID, userID); err != nil {
		return nil, fmt.Errorf("failed to add member: %w", err)
	}
	if err := uc.inviteRepo.IncrementUses(code); err != nil {
		return nil, fmt.Errorf("failed to record invite use: %w", err)
	}
	return server, nil
}
