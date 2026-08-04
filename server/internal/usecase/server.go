package usecase

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/pkg/filestorage"
)

type serverUseCase struct {
	serverRepo  domain.ServerRepository
	channelRepo domain.ChannelRepository
	userRepo    domain.UserRepository
	roleRepo    domain.RoleRepository
	storage     filestorage.Storage
	perms       domain.PermissionUseCase
}

func NewServerUseCase(
	serverRepo domain.ServerRepository,
	channelRepo domain.ChannelRepository,
	userRepo domain.UserRepository,
	roleRepo domain.RoleRepository,
	storage filestorage.Storage,
	perms domain.PermissionUseCase,
) domain.ServerUseCase {
	return &serverUseCase{
		serverRepo:  serverRepo,
		channelRepo: channelRepo,
		userRepo:    userRepo,
		roleRepo:    roleRepo,
		storage:     storage,
		perms:       perms,
	}
}

func (uc *serverUseCase) CreateServer(name string, ownerID uuid.UUID) (*domain.Server, error) {
	// Verify user exists
	_, err := uc.userRepo.GetByID(ownerID)
	if err != nil {
		return nil, fmt.Errorf("owner not found: %w", err)
	}

	existing, err := uc.serverRepo.GetByName(name)
	if err != nil && !errors.Is(err, domain.ErrServerNotFound) {
		return nil, fmt.Errorf("failed to check server name: %w", err)
	}
	if existing != nil {
		return nil, domain.ErrServerNameTaken
	}

	now := time.Now()
	server := &domain.Server{
		ID:        uuid.New(),
		Name:      name,
		OwnerID:   ownerID,
		CreatedAt: now,
		UpdatedAt: now,
	}

	if err := uc.serverRepo.Create(server); err != nil {
		return nil, fmt.Errorf("failed to create server: %w", err)
	}

	// Владелец хранится обычной строкой в server_members — на этом держатся
	// внешний ключ member_roles, роль @everyone и список участников.
	// Миграция 009 забэкфиллила только существующие серверы, новые обязаны
	// регистрировать владельца здесь.
	if err := uc.serverRepo.AddMember(server.ID, ownerID); err != nil {
		uc.compensateFailedCreate(server.ID)
		return nil, fmt.Errorf("failed to add owner as member: %w", err)
	}

	// Миграция 011 засеяла роль @everyone только для серверов, существовавших
	// на момент миграции. Без дефолтной роли ResolveMemberPermissions вернёт
	// (0, -1) для любого не-владельца — состояние, которое остальной код
	// считает невозможным (HighestPosition -1 == "нет дефолтной роли на сервере").
	// Новые серверы обязаны создавать её здесь.
	everyoneRole := &domain.Role{
		ID:          uuid.New(),
		ServerID:    server.ID,
		Name:        "@everyone",
		Position:    0,
		Permissions: domain.PermViewChannels | domain.PermSendMessages,
		IsDefault:   true,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := uc.roleRepo.Create(everyoneRole); err != nil {
		uc.compensateFailedCreate(server.ID)
		return nil, fmt.Errorf("failed to create default role: %w", err)
	}

	// Create default text channel
	textChannel := &domain.Channel{
		ID:        uuid.New(),
		ServerID:  server.ID,
		Name:      "general",
		Type:      domain.ChannelTypeText,
		Position:  0,
		CreatedAt: now,
		UpdatedAt: now,
	}

	if err := uc.channelRepo.Create(textChannel); err != nil {
		uc.compensateFailedCreate(server.ID)
		return nil, fmt.Errorf("failed to create default channel: %w", err)
	}

	// Create default voice channel
	voiceChannel := &domain.Channel{
		ID:        uuid.New(),
		ServerID:  server.ID,
		Name:      "General",
		Type:      domain.ChannelTypeVoice,
		Position:  1,
		CreatedAt: now,
		UpdatedAt: now,
	}

	if err := uc.channelRepo.Create(voiceChannel); err != nil {
		uc.compensateFailedCreate(server.ID)
		return nil, fmt.Errorf("failed to create default voice channel: %w", err)
	}

	return server, nil
}

// compensateFailedCreate удаляет сервер, если какой-то из шагов CreateServer
// после успешного serverRepo.Create упал. Без этого в БД остаётся сервер без
// владельца в server_members и/или без роли @everyone — неремонтируемое
// состояние (см. проектную заметку про инвариант "@everyone + владелец").
// ON DELETE CASCADE на server_id уберёт членство, роль и уже созданные
// каналы. Ошибку компенсации логировать здесь нечем — best-effort, как
// storage.Delete в UpdateServerIcon.
func (uc *serverUseCase) compensateFailedCreate(serverID uuid.UUID) {
	_ = uc.serverRepo.Delete(serverID)
}

func (uc *serverUseCase) GetServer(id uuid.UUID) (*domain.Server, error) {
	server, err := uc.serverRepo.GetByID(id)
	if err != nil {
		return nil, fmt.Errorf("failed to get server: %w", err)
	}

	return server, nil
}

func (uc *serverUseCase) GetUserServers(userID uuid.UUID) ([]*domain.Server, error) {
	// Get servers owned by user
	ownedServers, err := uc.serverRepo.GetByOwner(userID)
	if err != nil {
		return nil, fmt.Errorf("failed to get owned servers: %w", err)
	}

	// Get servers where user is a member
	memberServers, err := uc.serverRepo.GetByMember(userID)
	if err != nil {
		return nil, fmt.Errorf("failed to get member servers: %w", err)
	}

	// Merge and deduplicate
	serverMap := make(map[uuid.UUID]*domain.Server)
	for _, s := range ownedServers {
		serverMap[s.ID] = s
	}
	for _, s := range memberServers {
		serverMap[s.ID] = s
	}

	var servers []*domain.Server
	for _, s := range serverMap {
		servers = append(servers, s)
	}

	return servers, nil
}

func (uc *serverUseCase) JoinServer(serverID, userID uuid.UUID) error {
	server, err := uc.serverRepo.GetByID(serverID)
	if err != nil {
		return fmt.Errorf("server not found: %w", err)
	}

	if server.OwnerID == userID {
		return fmt.Errorf("user is the owner of this server")
	}

	isMember, err := uc.serverRepo.IsMember(serverID, userID)
	if err != nil {
		return fmt.Errorf("failed to check membership: %w", err)
	}
	if isMember {
		return fmt.Errorf("user is already a member")
	}

	return uc.serverRepo.AddMember(serverID, userID)
}

func (uc *serverUseCase) LeaveServer(serverID, userID uuid.UUID) error {
	server, err := uc.serverRepo.GetByID(serverID)
	if err != nil {
		return fmt.Errorf("server not found: %w", err)
	}

	if server.OwnerID == userID {
		return fmt.Errorf("owner cannot leave their own server")
	}

	return uc.serverRepo.RemoveMember(serverID, userID)
}

func (uc *serverUseCase) SearchServers(query string, limit int) ([]*domain.Server, error) {
	if limit <= 0 {
		limit = 20
	}
	servers, err := uc.serverRepo.Search(query, limit, 0)
	if err != nil {
		return nil, fmt.Errorf("failed to search servers: %w", err)
	}
	return servers, nil
}

func (uc *serverUseCase) CreateChannel(serverID, userID uuid.UUID, name string, channelType domain.ChannelType, isPrivate bool) (*domain.Channel, error) {
	if err := uc.requirePermission(serverID, userID, domain.PermManageChannels); err != nil {
		return nil, err
	}

	// Get max position for ordering
	channels, err := uc.channelRepo.GetByServerID(serverID)
	position := 0
	if err == nil {
		position = len(channels)
	}

	now := time.Now()
	channel := &domain.Channel{
		ID:        uuid.New(),
		ServerID:  serverID,
		Name:      name,
		Type:      channelType,
		Position:  position,
		IsPrivate: isPrivate,
		OwnerID:   userID,
		CreatedAt: now,
		UpdatedAt: now,
	}

	if err := uc.channelRepo.Create(channel); err != nil {
		return nil, fmt.Errorf("failed to create channel: %w", err)
	}

	if isPrivate {
		if err := uc.channelRepo.AddMember(channel.ID, userID, userID); err != nil {
			return nil, fmt.Errorf("failed to add channel owner as member: %w", err)
		}
	}

	return channel, nil
}

func (uc *serverUseCase) GetChannels(serverID, userID uuid.UUID) ([]*domain.Channel, error) {
	ps, err := uc.perms.Resolve(serverID, userID)
	if err != nil {
		return nil, err
	}
	if !ps.Has(domain.PermViewChannels) {
		return nil, domain.ErrForbidden
	}

	channels, err := uc.channelRepo.GetByServerID(serverID)
	if err != nil {
		return nil, fmt.Errorf("failed to get channels: %w", err)
	}

	visible := make([]*domain.Channel, 0, len(channels))
	for _, ch := range channels {
		if !ch.IsPrivate {
			visible = append(visible, ch)
			continue
		}
		isMember := false
		if !ch.IsManagedBy(userID, ps) {
			isMember, err = uc.channelRepo.IsMember(ch.ID, userID)
			if err != nil {
				return nil, fmt.Errorf("check channel membership: %w", err)
			}
		}
		if ch.CanAccess(userID, ps, isMember) {
			visible = append(visible, ch)
		}
	}

	return visible, nil
}

func (uc *serverUseCase) GetMembers(serverID, userID uuid.UUID) ([]*domain.MemberWithUser, error) {
	if err := uc.requirePermission(serverID, userID, domain.PermViewChannels); err != nil {
		return nil, err
	}

	members, err := uc.serverRepo.GetMembersWithUsers(serverID)
	if err != nil {
		return nil, fmt.Errorf("failed to get members: %w", err)
	}
	return members, nil
}

// requireOwner проверяет, что сервер существует и userID — его владелец.
// Возвращает domain.ErrServerNotFound или domain.ErrForbidden.
// Используется только для DeleteServer: удаление сервера — привилегия
// владения, иначе роль с MANAGE_SERVER снесла бы сервер вместе с владельцем.
func (uc *serverUseCase) requireOwner(serverID, userID uuid.UUID) (*domain.Server, error) {
	server, err := uc.serverRepo.GetByID(serverID)
	if err != nil {
		return nil, fmt.Errorf("server %s: %w", serverID, domain.ErrServerNotFound)
	}
	if server.OwnerID != userID {
		return nil, domain.ErrForbidden
	}
	return server, nil
}

// requirePermission проверяет, что сервер существует и у пользователя есть
// право perm. requireOwner остаётся только для DeleteServer: удаление сервера —
// привилегия владения, иначе роль с MANAGE_SERVER снесла бы сервер вместе с владельцем.
func (uc *serverUseCase) requirePermission(serverID, userID uuid.UUID, perm domain.Permission) error {
	ps, err := uc.perms.Resolve(serverID, userID)
	if err != nil {
		return err
	}
	if !ps.Has(perm) {
		return domain.ErrForbidden
	}
	return nil
}

func (uc *serverUseCase) UpdateServer(serverID, userID uuid.UUID, name string) (*domain.Server, error) {
	if err := uc.requirePermission(serverID, userID, domain.PermManageServer); err != nil {
		return nil, err
	}
	server, err := uc.serverRepo.GetByID(serverID)
	if err != nil {
		return nil, fmt.Errorf("server %s: %w", serverID, domain.ErrServerNotFound)
	}

	existing, err := uc.serverRepo.GetByName(name)
	if err != nil && !errors.Is(err, domain.ErrServerNotFound) {
		return nil, fmt.Errorf("failed to check server name: %w", err)
	}
	if existing != nil && existing.ID != serverID {
		return nil, domain.ErrServerNameTaken
	}

	if err := uc.serverRepo.Update(serverID, map[string]interface{}{"name": name}); err != nil {
		return nil, fmt.Errorf("failed to update server: %w", err)
	}

	server.Name = name
	server.UpdatedAt = time.Now()
	return server, nil
}

func (uc *serverUseCase) DeleteServer(serverID, userID uuid.UUID) error {
	if _, err := uc.requireOwner(serverID, userID); err != nil {
		return err
	}

	if err := uc.serverRepo.Delete(serverID); err != nil {
		return fmt.Errorf("failed to delete server: %w", err)
	}
	return nil
}

func (uc *serverUseCase) UpdateChannel(serverID, channelID, userID uuid.UUID, name string, isPrivate bool) (*domain.Channel, error) {
	if err := uc.requirePermission(serverID, userID, domain.PermManageChannels); err != nil {
		return nil, err
	}

	channel, err := uc.channelRepo.GetByID(channelID)
	if err != nil {
		return nil, fmt.Errorf("get channel: %w", err)
	}
	if channel.ServerID != serverID {
		return nil, fmt.Errorf("channel %s: %w", channelID, domain.ErrChannelNotFound)
	}

	privacyChanged := isPrivate != channel.IsPrivate
	if privacyChanged {
		ps, err := uc.perms.Resolve(serverID, userID)
		if err != nil {
			return nil, err
		}
		if !channel.IsManagedBy(userID, ps) {
			return nil, domain.ErrChannelForbidden
		}
	}

	if err := uc.channelRepo.Update(channelID, map[string]interface{}{"name": name, "is_private": isPrivate}); err != nil {
		return nil, fmt.Errorf("failed to update channel: %w", err)
	}

	if privacyChanged {
		if isPrivate {
			if err := uc.channelRepo.AddMember(channel.ID, channel.OwnerID, channel.OwnerID); err != nil {
				return nil, fmt.Errorf("failed to add channel owner as member: %w", err)
			}
		} else {
			if err := uc.channelRepo.RemoveAllMembers(channel.ID); err != nil {
				return nil, fmt.Errorf("failed to clear channel members: %w", err)
			}
		}
	}

	channel.Name = name
	channel.IsPrivate = isPrivate
	channel.UpdatedAt = time.Now()
	return channel, nil
}

func (uc *serverUseCase) DeleteChannel(serverID, channelID, userID uuid.UUID) error {
	if err := uc.requirePermission(serverID, userID, domain.PermManageChannels); err != nil {
		return err
	}

	channel, err := uc.channelRepo.GetByID(channelID)
	if err != nil {
		return fmt.Errorf("get channel: %w", err)
	}
	if channel.ServerID != serverID {
		return fmt.Errorf("channel %s: %w", channelID, domain.ErrChannelNotFound)
	}

	deleted, err := uc.channelRepo.DeleteIfNotLast(channelID, serverID)
	if err != nil {
		return fmt.Errorf("failed to delete channel: %w", err)
	}
	if !deleted {
		return domain.ErrLastChannel
	}
	return nil
}

// UpdateServerIcon валидирует data как PNG/JPEG, сохраняет файл, обновляет
// icon_url сервера и удаляет старый файл иконки (best-effort — как у
// UpdateAvatar, орфан-файл не хуже жёсткого фейла запроса).
func (uc *serverUseCase) UpdateServerIcon(serverID, userID uuid.UUID, data []byte) (*domain.Server, error) {
	if err := uc.requirePermission(serverID, userID, domain.PermManageServer); err != nil {
		return nil, err
	}
	server, err := uc.serverRepo.GetByID(serverID)
	if err != nil {
		return nil, fmt.Errorf("server %s: %w", serverID, domain.ErrServerNotFound)
	}

	ext, contentType, err := validateImage(data)
	if err != nil {
		return nil, err
	}

	oldIconURL := server.IconURL

	key := fmt.Sprintf("server-icons/%s/%s.%s", serverID, randomHex(8), ext)
	url, err := uc.storage.Save(context.Background(), key, bytes.NewReader(data), contentType)
	if err != nil {
		return nil, fmt.Errorf("save server icon: %w", err)
	}

	if err := uc.serverRepo.Update(serverID, map[string]interface{}{"icon_url": url}); err != nil {
		return nil, fmt.Errorf("update server icon url: %w", err)
	}

	if oldIconURL != nil {
		_ = uc.storage.Delete(context.Background(), *oldIconURL)
	}

	server.IconURL = &url
	return server, nil
}

// RemoveServerIcon очищает icon_url сервера и удаляет файл. No-op, если
// иконка уже не установлена.
func (uc *serverUseCase) RemoveServerIcon(serverID, userID uuid.UUID) (*domain.Server, error) {
	if err := uc.requirePermission(serverID, userID, domain.PermManageServer); err != nil {
		return nil, err
	}
	server, err := uc.serverRepo.GetByID(serverID)
	if err != nil {
		return nil, fmt.Errorf("server %s: %w", serverID, domain.ErrServerNotFound)
	}

	if server.IconURL == nil {
		return server, nil
	}

	oldIconURL := *server.IconURL
	if err := uc.serverRepo.Update(serverID, map[string]interface{}{"icon_url": nil}); err != nil {
		return nil, fmt.Errorf("clear server icon url: %w", err)
	}
	_ = uc.storage.Delete(context.Background(), oldIconURL)

	server.IconURL = nil
	return server, nil
}
