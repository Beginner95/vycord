package sfu

import (
	"encoding/json"
	"fmt"
	"sync"

	"github.com/google/uuid"
	"github.com/pion/webrtc/v4"
)

// Room represents a group voice/video call
type Room struct {
	ID      uuid.UUID
	peers   map[string]*Peer
	mu      sync.RWMutex
	onClose func(roomID string)
}

// Peer represents a single participant in a group call
type Peer struct {
	ID         string
	UserID     string
	RoomID     string
	Publisher  *webrtc.PeerConnection
	Subscribers map[string]*webrtc.PeerConnection
	tracks     []*webrtc.TrackLocalStaticRTP
	mu         sync.RWMutex
}

// SFU manages group calls
type SFU struct {
	rooms       map[string]*Room
	mu          sync.RWMutex
	mediaEngine *webrtc.MediaEngine
}

func NewSFU() (*SFU, error) {
	m := &webrtc.MediaEngine{}

	// Register codecs
	if err := m.RegisterDefaultCodecs(); err != nil {
		return nil, fmt.Errorf("failed to register codecs: %w", err)
	}

	return &SFU{
		rooms:       make(map[string]*Room),
		mediaEngine: m,
	}, nil
}

// CreateRoom creates a new group call room
func (s *SFU) CreateRoom(roomID string) *Room {
	s.mu.Lock()
	defer s.mu.Unlock()

	if room, exists := s.rooms[roomID]; exists {
		return room
	}

	room := &Room{
		ID:    uuid.MustParse(roomID),
		peers: make(map[string]*Peer),
	}

	room.onClose = func(id string) {
		s.mu.Lock()
		delete(s.rooms, id)
		s.mu.Unlock()
	}

	s.rooms[roomID] = room
	return room
}

// GetRoom returns an existing room
func (s *SFU) GetRoom(roomID string) (*Room, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	room, exists := s.rooms[roomID]
	if !exists {
		return nil, fmt.Errorf("room not found: %s", roomID)
	}
	return room, nil
}

// JoinRoom adds a peer to a room
func (s *SFU) JoinRoom(roomID, peerID, userID string) (*Room, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	room, exists := s.rooms[roomID]
	if !exists {
		return nil, fmt.Errorf("room not found: %s", roomID)
	}

	if _, exists := room.peers[peerID]; exists {
		return nil, fmt.Errorf("peer already exists: %s", peerID)
	}

	return room, nil
}

// AddPeer adds a peer to a room
func (r *Room) AddPeer(peer *Peer) {
	r.mu.Lock()
	r.peers[peer.ID] = peer
	r.mu.Unlock()
}

// RemovePeer removes a peer from a room
func (r *Room) RemovePeer(peerID string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	peer, exists := r.peers[peerID]
	if !exists {
		return
	}

	peer.Close()
	delete(r.peers, peerID)

	// If room is empty, close it
	if len(r.peers) == 0 && r.onClose != nil {
		r.onClose(r.ID.String())
	}
}

// GetPeers returns all peers in the room
func (r *Room) GetPeers() []*Peer {
	r.mu.RLock()
	defer r.mu.RUnlock()

	peers := make([]*Peer, 0, len(r.peers))
	for _, p := range r.peers {
		peers = append(peers, p)
	}
	return peers
}

// NewPeerConnection creates a new PeerConnection for the SFU
func (s *SFU) NewPeerConnection() (*webrtc.PeerConnection, error) {
	cfg := webrtc.Configuration{
		ICEServers: []webrtc.ICEServer{
			{URLs: []string{"stun:stun.l.google.com:19302"}},
			{URLs: []string{"stun:stun1.l.google.com:19302"}},
		},
	}

	api := webrtc.NewAPI(webrtc.WithMediaEngine(s.mediaEngine))
	pc, err := api.NewPeerConnection(cfg)
	if err != nil {
		return nil, fmt.Errorf("failed to create peer connection: %w", err)
	}

	return pc, nil
}

// AddTrackToSubscribers adds a track to all subscribers in the room
func (r *Room) AddTrackToSubscribers(track *webrtc.TrackLocalStaticRTP, publisherID string) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	for _, peer := range r.peers {
		if peer.ID == publisherID {
			continue
		}

		peer.mu.RLock()
		for _, subPC := range peer.Subscribers {
			_, err := subPC.AddTrack(track)
			if err != nil {
				continue
			}
		}
		peer.mu.RUnlock()
	}
}

// CreateSubscriber creates a new subscriber PeerConnection for a peer
func (p *Peer) CreateSubscriber() (*webrtc.PeerConnection, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	cfg := webrtc.Configuration{
		ICEServers: []webrtc.ICEServer{
			{URLs: []string{"stun:stun.l.google.com:19302"}},
		},
	}

	sub, err := webrtc.NewPeerConnection(cfg)
	if err != nil {
		return nil, fmt.Errorf("failed to create subscriber: %w", err)
	}

	if p.Subscribers == nil {
		p.Subscribers = make(map[string]*webrtc.PeerConnection)
	}
	subID := fmt.Sprintf("%s-sub-%d", p.ID, len(p.Subscribers))
	p.Subscribers[subID] = sub

	// Add all existing tracks from other peers
	p.mu.RUnlock()
	p.mu.RLock()
	// Note: tracks should be added by the room manager
	p.mu.RUnlock()

	sub.OnICECandidate(func(candidate *webrtc.ICECandidate) {
		if candidate == nil {
			return
		}
		// ICE candidate will be sent via WebSocket
	})

	return sub, nil
}

// Close closes the peer and all its connections
func (p *Peer) Close() {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.Publisher != nil {
		p.Publisher.Close()
	}

	for _, sub := range p.Subscribers {
		sub.Close()
	}
	p.Subscribers = nil
}

// PeerMessage represents a WebSocket message for the SFU
type PeerMessage struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

// JoinPayload is the payload for joining a room
type JoinPayload struct {
	RoomID string `json:"room_id"`
	UserID string `json:"user_id"`
}

// SDPPayload is the payload for SDP offer/answer
type SDPPayload struct {
	RoomID string          `json:"room_id"`
	UserID string          `json:"user_id"`
	SDP    json.RawMessage `json:"sdp"`
}

// ICEPayload is the payload for ICE candidates
type ICEPayload struct {
	RoomID    string          `json:"room_id"`
	UserID    string          `json:"user_id"`
	Candidate json.RawMessage `json:"candidate"`
}
