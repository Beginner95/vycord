package application

import (
	"log/slog"
	"sync"

	"github.com/vycord/server/internal/sfu/domain"
	sfuwebrtc "github.com/vycord/server/internal/sfu/infrastructure/webrtc"
)

// Stats is a snapshot of SFU runtime state for observability.
type Stats struct {
	Rooms        int            `json:"rooms"`
	Participants int            `json:"participants"`
	RoomDetails  []RoomStats    `json:"room_details,omitempty"`
}

// RoomStats holds per-room snapshot data.
type RoomStats struct {
	RoomID       string `json:"room_id"`
	Participants int    `json:"participants"`
}

// RoomManager creates and tracks RoomSessions.
// It is the top-level entry point for the transport layer.
type RoomManager struct {
	peerFactory *sfuwebrtc.PeerFactory
	log         *slog.Logger

	mu    sync.RWMutex
	rooms map[string]*RoomSession // roomID → session
}

func NewRoomManager(peerFactory *sfuwebrtc.PeerFactory, log *slog.Logger) *RoomManager {
	return &RoomManager{
		peerFactory: peerFactory,
		log:         log,
		rooms:       make(map[string]*RoomSession),
	}
}

// GetOrCreateRoom returns an existing RoomSession or creates a new one.
func (m *RoomManager) GetOrCreateRoom(roomID string) *RoomSession {
	m.mu.Lock()
	defer m.mu.Unlock()

	if rs, ok := m.rooms[roomID]; ok {
		return rs
	}

	room := domain.NewRoom(roomID, nil) // events handled at application level
	rs := NewRoomSession(room, m.peerFactory, m.log)
	m.rooms[roomID] = rs

	// Remove room when it becomes empty.
	go func() {
		<-rs.Done()
		m.mu.Lock()
		delete(m.rooms, roomID)
		m.mu.Unlock()
		m.log.Info("room closed", "room_id", roomID)
	}()

	m.log.Info("room created", "room_id", roomID)
	return rs
}

// GetRoom returns an existing RoomSession or nil.
func (m *RoomManager) GetRoom(roomID string) (*RoomSession, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	rs, ok := m.rooms[roomID]
	return rs, ok
}

// Stats returns a snapshot of current SFU state for health checks and monitoring.
func (m *RoomManager) Stats() Stats {
	m.mu.RLock()
	defer m.mu.RUnlock()

	s := Stats{
		Rooms:       len(m.rooms),
		RoomDetails: make([]RoomStats, 0, len(m.rooms)),
	}
	for id, rs := range m.rooms {
		participants := rs.participantCount()
		s.Participants += participants
		s.RoomDetails = append(s.RoomDetails, RoomStats{
			RoomID:       id,
			Participants: participants,
		})
	}
	return s
}

// Shutdown closes all active participant sessions across all rooms.
// Call this during graceful shutdown before stopping the HTTP server so that
// PeerConnections are closed cleanly and clients receive proper disconnection
// events rather than an abrupt TCP reset.
func (m *RoomManager) Shutdown() {
	m.mu.RLock()
	sessions := make([]*ParticipantSession, 0)
	for _, rs := range m.rooms {
		rs.mu.RLock()
		for _, ps := range rs.sessions {
			sessions = append(sessions, ps)
		}
		rs.mu.RUnlock()
	}
	m.mu.RUnlock()

	for _, ps := range sessions {
		ps.Close()
	}
	m.log.Info("SFU shutdown: all participant sessions closed", "count", len(sessions))
}

// Join is a convenience method: get-or-create room + join participant.
func (m *RoomManager) Join(
	roomID, participantID, userID string,
	session SignalingSession,
) (*RoomSession, *ParticipantSession, error) {
	rs := m.GetOrCreateRoom(roomID)

	participant := domain.NewParticipant(participantID, userID, roomID)
	ps, err := rs.Join(participant, session)
	if err != nil {
		return nil, nil, err
	}

	return rs, ps, nil
}
