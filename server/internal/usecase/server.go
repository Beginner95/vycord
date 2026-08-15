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

func (uc *serverUseCase) CreateServer(name string, ownerID uuid.UUID, isPrivate bool) (*domain.Server, error) {
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
		IsPrivate: isPrivate,
		CreatedAt: now,
		UpdatedAt: now,
	}

	if err := uc.serverRepo.Create(server); err != nil {
		return nil, fmt.Errorf("failed to create server: %w", err)
	}

	// Владелец хранится обычной строкой в server_members — на этом держатся
	// внешний ключ member_roles, роль @everyone и список участников.
	if err := uc.serverRepo.AddMember(server.ID, ownerID); err != nil {
		uc.compensateFailedCreate(server.ID)
		return nil, fmt.Errorf("failed to add owner as member: %w", err)
	}

	// PermCreateInvite в @everyone по умолчанию — любой участник может
	// пригласить друга (аналог CREATE_INSTANT_INVITE в Discord), роль может
	// это право забрать.
	everyoneRole := &domain.Role{
		ID:          uuid.New(),
		ServerID:    server.ID,
		Name:        "@everyone",
		Position:    0,
		Permissions: domain.PermViewChannels | domain.PermSendMessages | domain.PermCreateInvite,
		IsDefault:   true,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := uc.roleRepo.Create(everyoneRole); err != nil {
		uc.compensateFailedCreate(server.ID)
		return nil, fmt.Errorf("failed to create default role: %w", err)
	}

	// Create default channel
	channel := &domain.Channel{
		ID:        uuid.New(),
		ServerID:  server.ID,
		Name:      "general",
		Position:  0,
		CreatedAt: now,
		UpdatedAt: now,
	}

	if err := uc.channelRepo.Create(channel); err != nil {
		uc.compensateFailedCreate(server.ID)
		return nil, fmt.Errorf("failed to create default channel: %w", err)
	}

	return server, nil
}

// compensateFailedCreate удаляет сервер, если какой-то из шагов CreateServer
// после успешного serverRepo.Create упал.
func (uc *serverUseCase) compensateFailedCreate(serverID uuid.UUID) {
	_ = uc.serverRepo.Delete(serverID)
}

// GetServer скрывает приватный сервер от всех, кроме владельца и участников:
// возвращает ErrServerNotFound, а не ErrForbidden, чтобы приватный сервер
// был неотличим от несуществующего для постороннего запроса по ID.
func (uc *serverUseCase) GetServer(id, userID uuid.UUID) (*domain.Server, error) {
	server, err := uc.serverRepo.GetByID(id)
	if err != nil {
		return nil, fmt.Errorf("failed to get server: %w", err)
	}

	if server.IsPrivate && server.OwnerID != userID {
		isMember, err := uc.serverRepo.IsMember(id, userID)
		if err != nil {
			return nil, fmt.Errorf("failed to check membership: %w", err)
		}
		if !isMember {
			return nil, fmt.Errorf("server %s: %w", id, domain.ErrServerNotFound)
		}
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

// JoinServer — прямое вступление работает только для публичных серверов.
// Приватный сервер отвечает тем же ErrServerNotFound, что и GetServer: путь
// внутрь закрытого сервера — только через инвайт (InviteUseCase.JoinViaInvite).
func (uc *serverUseCase) JoinServer(serverID, userID uuid.UUID) error {
	server, err := uc.serverRepo.GetByID(serverID)
	if err != nil {
		return fmt.Errorf("server not found: %w", err)
	}

	if server.IsPrivate {
		return fmt.Errorf("server %s: %w", serverID, domain.ErrServerNotFound)
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

func (uc *serverUseCase) CreateChannel(serverID, userID uuid.UUID, name string) (*domain.Channel, error) {
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
		Position:  position,
		CreatedAt: now,
		UpdatedAt: now,
	}

	if err := uc.channelRepo.Create(channel); err != nil {
		return nil, fmt.Errorf("failed to create channel: %w", err)
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

	return channels, nil
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
// право perm.
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

// UpdateServer: isPrivate == nil оставляет текущую приватность нетронутой —
// тот же паттерн, что раньше защищал is_private канала от случайного сброса
// плоским PATCH {"name": "..."} без этого ключа.
func (uc *serverUseCase) UpdateServer(serverID, userID uuid.UUID, name string, isPrivate *bool) (*domain.Server, error) {
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

	updates := map[string]interface{}{"name": name}
	if isPrivate != nil {
		updates["is_private"] = *isPrivate
	}
	if err := uc.serverRepo.Update(serverID, updates); err != nil {
		return nil, fmt.Errorf("failed to update server: %w", err)
	}

	server.Name = name
	if isPrivate != nil {
		server.IsPrivate = *isPrivate
	}
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

func (uc *serverUseCase) UpdateChannel(serverID, channelID, userID uuid.UUID, name string) (*domain.Channel, error) {
	channel, err := uc.channelRepo.GetByID(channelID)
	if err != nil {
		return nil, fmt.Errorf("get channel: %w", err)
	}
	if channel.ServerID != serverID {
		return nil, fmt.Errorf("channel %s: %w", channelID, domain.ErrChannelNotFound)
	}

	if err := uc.requirePermission(serverID, userID, domain.PermManageChannels); err != nil {
		return nil, err
	}

	if err := uc.channelRepo.Update(channelID, map[string]interface{}{"name": name}); err != nil {
		return nil, fmt.Errorf("failed to update channel: %w", err)
	}

	channel.Name = name
	channel.UpdatedAt = time.Now()
	return channel, nil
}

func (uc *serverUseCase) DeleteChannel(serverID, channelID, userID uuid.UUID) error {
	channel, err := uc.channelRepo.GetByID(channelID)
	if err != nil {
		return fmt.Errorf("get channel: %w", err)
	}
	if channel.ServerID != serverID {
		return fmt.Errorf("channel %s: %w", channelID, domain.ErrChannelNotFound)
	}

	if err := uc.requirePermission(serverID, userID, domain.PermManageChannels); err != nil {
		return err
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
// icon_url сервера и удаляет старый файл иконки (best-effort).
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

// CheckChannelAccess: доступ к каналу равен членству в его сервере с правом
// PermViewChannels — приватность канала больше не существует, только
// приватность сервера (уже обеспечена тем, что не-участник получает от
// perms.Resolve нулевой набор прав).
func (uc *serverUseCase) CheckChannelAccess(channelID, userID uuid.UUID) (*domain.Channel, error) {
	ch, err := uc.channelRepo.GetByID(channelID)
	if err != nil {
		return nil, err
	}

	ps, err := uc.perms.Resolve(ch.ServerID, userID)
	if err != nil {
		return nil, err
	}
	if !ps.Has(domain.PermViewChannels) {
		return nil, domain.ErrChannelForbidden
	}

	return ch, nil
}

// GetServerAudience returns the user IDs allowed to receive realtime events
// scoped to serverID: nil for a public server (broadcast to everyone),
// otherwise every member of the server.
func (uc *serverUseCase) GetServerAudience(serverID uuid.UUID) ([]uuid.UUID, error) {
	server, err := uc.serverRepo.GetByID(serverID)
	if err != nil {
		return nil, fmt.Errorf("get server: %w", err)
	}
	if !server.IsPrivate {
		return nil, nil
	}

	members, err := uc.serverRepo.GetMembersWithUsers(serverID)
	if err != nil {
		return nil, fmt.Errorf("get server members: %w", err)
	}

	result := make([]uuid.UUID, 0, len(members))
	for _, m := range members {
		result = append(result, m.UserID)
	}
	return result, nil
}

// GetChannelAudience — то же самое, что GetServerAudience, но по channelID:
// используется войс-ростером в hub.go (BroadcastVoiceParticipants ключуется
// по каналу, а не по серверу).
func (uc *serverUseCase) GetChannelAudience(channelID uuid.UUID) ([]uuid.UUID, error) {
	ch, err := uc.channelRepo.GetByID(channelID)
	if err != nil {
		return nil, err
	}
	return uc.GetServerAudience(ch.ServerID)
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
