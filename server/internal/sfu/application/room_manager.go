package application

import (
	"errors"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/vycord/server/internal/sfu/domain"
	sfuwebrtc "github.com/vycord/server/internal/sfu/infrastructure/webrtc"
)

// guestDenyTTL mirrors domain.SFUGuestDenyTTL. It is duplicated rather than
// imported: the SFU packages deliberately do not depend on the API's domain.
const guestDenyTTL = 2 * time.Minute

// guestIdentityPrefix mirrors authtoken.GuestIdentityPrefix.
const guestIdentityPrefix = "guest:"

// Stats is a snapshot of SFU runtime state for observability.
type Stats struct {
	Rooms        int         `json:"rooms"`
	Participants int         `json:"participants"`
	RoomDetails  []RoomStats `json:"room_details,omitempty"`
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

	// guestDeny/usedJTI are the SFU's entire memory of guests. Both are
	// time-bounded and in-process: the SFU never touches the database, so a
	// restart simply forgets them — which is safe, because every guest token
	// also expires within a minute and the API refuses to mint a new one for a
	// kicked guest.
	guestMu   sync.Mutex
	guestDeny map[string]time.Time
	usedJTI   map[string]time.Time
}

func NewRoomManager(peerFactory *sfuwebrtc.PeerFactory, log *slog.Logger) *RoomManager {
	return &RoomManager{
		peerFactory: peerFactory,
		log:         log,
		rooms:       make(map[string]*RoomSession),
		guestDeny:   make(map[string]time.Time),
		usedJTI:     make(map[string]time.Time),
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

	// Remove room when it becomes empty. Guarded by identity (evictClosedRoom)
	// rather than an unconditional delete: Join's ErrRoomClosed retry path can
	// evict this same closed room and register a fresh one under roomID before
	// this goroutine wakes up (rs.Done() was already closed by the eviction
	// that triggered the retry) — an unconditional delete here would then wipe
	// out the newly registered room instead of the stale one.
	go func() {
		<-rs.Done()
		m.evictClosedRoom(roomID, rs)
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
		if errors.Is(err, domain.ErrRoomClosed) {
			// Solo-reconnect race: when the only participant in the room
			// reconnects, RoomSession.Join evicts their stale session first
			// (same user_id) to avoid a duplicate. That eviction empties the
			// domain Room, which closes it — so the very next line,
			// room.AddParticipant, returns ErrRoomClosed and this join fails
			// even though it should trivially succeed. Without this retry the
			// join only recovers once the reaper goroutine in
			// GetOrCreateRoom (waiting on rs.Done()) removes the closed room
			// from the map, which races with the client's own retry loop.
			// Mirror the reaper here: evict the closed room ourselves and
			// retry once against a freshly created one.
			m.evictClosedRoom(roomID, rs)
			rs = m.GetOrCreateRoom(roomID)
			ps, err = rs.Join(participant, session)
		}
		if err != nil {
			return nil, nil, err
		}
	}

	return rs, ps, nil
}

// Presence returns a snapshot of every non-empty room and the ACCOUNT user IDs
// in it — guests are excluded on purpose: the API's reconciliation worker
// parses these as UUIDs (presence.parseSnapshot), and a "guest:<id>" entry
// would fail the whole tick for every call on the server.
func (m *RoomManager) Presence() map[string][]string {
	return m.presenceFiltered(false)
}

func (m *RoomManager) presenceFiltered(guests bool) map[string][]string {
	m.mu.RLock()
	defer m.mu.RUnlock()

	out := make(map[string][]string, len(m.rooms))
	for roomID, rs := range m.rooms {
		var ids []string
		for _, id := range rs.ExistingParticipants() {
			if strings.HasPrefix(id, guestIdentityPrefix) == guests {
				ids = append(ids, id)
			}
		}
		if len(ids) > 0 {
			out[roomID] = ids
		}
	}
	return out
}

// KickGuest evicts identity from roomID and deny-lists it for
// domain-level SFUGuestDenyTTL. The deny-list matters even when the guest is
// not currently in the room: the API may have minted a room token seconds
// before the kick, and that token is still cryptographically valid.
func (m *RoomManager) KickGuest(roomID, identity string) bool {
	m.denyGuest(identity)

	rs, ok := m.GetRoom(roomID)
	if !ok {
		return false
	}
	kicked := rs.KickByUserID(identity)
	if kicked {
		m.log.Info("guest kicked", "room_id", roomID, "identity", identity)
	}
	return kicked
}

func (m *RoomManager) denyGuest(identity string) {
	m.guestMu.Lock()
	defer m.guestMu.Unlock()
	m.sweepGuestStateLocked()
	m.guestDeny[identity] = time.Now().Add(guestDenyTTL)
}

// GuestDenied reports whether identity was kicked recently.
func (m *RoomManager) GuestDenied(identity string) bool {
	m.guestMu.Lock()
	defer m.guestMu.Unlock()
	until, ok := m.guestDeny[identity]
	return ok && time.Now().Before(until)
}

// UseJTI records a guest token's jti and reports whether it was unused. A
// guest room token is single-use: a token that leaked into an nginx access log
// cannot be replayed even inside its 60-second lifetime.
func (m *RoomManager) UseJTI(jti string, exp time.Time) bool {
	m.guestMu.Lock()
	defer m.guestMu.Unlock()
	m.sweepGuestStateLocked()
	if until, ok := m.usedJTI[jti]; ok && time.Now().Before(until) {
		return false
	}
	m.usedJTI[jti] = exp
	return true
}

func (m *RoomManager) sweepGuestStateLocked() {
	now := time.Now()
	for k, until := range m.usedJTI {
		if !now.Before(until) {
			delete(m.usedJTI, k)
		}
	}
	for k, until := range m.guestDeny {
		if !now.Before(until) {
			delete(m.guestDeny, k)
		}
	}
}

// GuestPresence is Presence for guests: room_id → guest identities. The API's
// absence worker uses it to tell "gone" from "reconnecting".
func (m *RoomManager) GuestPresence() map[string][]string {
	return m.presenceFiltered(true)
}

// Resume routes a resume_token to whichever room it names and hands off to
// RoomSession.Resume. Unlike Join, it never creates a room: an unknown room ID
// and an invalid/expired/wrong-user token both simply mean "cannot resume" —
// the caller (handler.ServeHTTP) falls back to a fresh join either way.
func (m *RoomManager) Resume(roomID, userID, token string, session SignalingSession) (*RoomSession, *ParticipantSession, bool) {
	rs, ok := m.GetRoom(roomID)
	if !ok {
		return nil, nil, false
	}
	ps, ok := rs.Resume(token, userID, session)
	if !ok {
		return nil, nil, false
	}
	return rs, ps, true
}

// evictClosedRoom removes rs from the room map if it is still the current
// session registered for roomID. Guards against racing with a concurrent
// GetOrCreateRoom/reaper that may have already replaced or removed it.
func (m *RoomManager) evictClosedRoom(roomID string, rs *RoomSession) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if cur, ok := m.rooms[roomID]; ok && cur == rs {
		delete(m.rooms, roomID)
	}
}
