package domain

import "sync"

// Participant is the domain entity for one call participant.
// It only holds identity and the tracks the participant has published.
// PeerConnection management lives in the application layer.
type Participant struct {
	ID     string
	UserID string
	RoomID string

	mu     sync.RWMutex
	tracks map[string]*PublishedTrack
}

func NewParticipant(id, userID, roomID string) *Participant {
	return &Participant{
		ID:     id,
		UserID: userID,
		RoomID: roomID,
		tracks: make(map[string]*PublishedTrack),
	}
}

func (p *Participant) AddTrack(t *PublishedTrack) {
	p.mu.Lock()
	p.tracks[t.ID] = t
	p.mu.Unlock()
}

func (p *Participant) RemoveTrack(trackID string) {
	p.mu.Lock()
	delete(p.tracks, trackID)
	p.mu.Unlock()
}

func (p *Participant) GetTracks() []*PublishedTrack {
	p.mu.RLock()
	defer p.mu.RUnlock()
	out := make([]*PublishedTrack, 0, len(p.tracks))
	for _, t := range p.tracks {
		out = append(out, t)
	}
	return out
}
