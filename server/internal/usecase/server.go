package usecase

import (
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/domain"
)

type serverUseCase struct {
	serverRepo  domain.ServerRepository
	channelRepo domain.ChannelRepository
	userRepo    domain.UserRepository
}

func NewServerUseCase(
	serverRepo domain.ServerRepository,
	channelRepo domain.ChannelRepository,
	userRepo domain.UserRepository,
) domain.ServerUseCase {
	return &serverUseCase{
		serverRepo:  serverRepo,
		channelRepo: channelRepo,
		userRepo:    userRepo,
	}
}

func (uc *serverUseCase) CreateServer(name string, ownerID uuid.UUID) (*domain.Server, error) {
	// Verify user exists
	_, err := uc.userRepo.GetByID(ownerID)
	if err != nil {
		return nil, fmt.Errorf("owner not found: %w", err)
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
		return nil, fmt.Errorf("failed to create default voice channel: %w", err)
	}

	return server, nil
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

func (uc *serverUseCase) CreateChannel(serverID uuid.UUID, name string, channelType domain.ChannelType) (*domain.Channel, error) {
	// Verify server exists
	_, err := uc.serverRepo.GetByID(serverID)
	if err != nil {
		return nil, fmt.Errorf("server not found: %w", err)
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
		CreatedAt: now,
		UpdatedAt: now,
	}

	if err := uc.channelRepo.Create(channel); err != nil {
		return nil, fmt.Errorf("failed to create channel: %w", err)
	}

	return channel, nil
}

func (uc *serverUseCase) GetChannels(serverID uuid.UUID) ([]*domain.Channel, error) {
	channels, err := uc.channelRepo.GetByServerID(serverID)
	if err != nil {
		return nil, fmt.Errorf("failed to get channels: %w", err)
	}

	return channels, nil
}
