package domain

import "sync"

// Participant is the domain entity for one call participant.
// It only holds identity and the tracks the participant has published.
// PeerConnection management lives in the application layer.
type Participant struct {
	ID     string
	UserID string
	RoomID string

	mu            sync.RWMutex
	tracks        map[string]*PublishedTrack
	sharingActive bool
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

// SetSharingActive records whether this participant is currently screen-sharing.
// This is the single source of truth for "is sharing right now" — a
// PublishedTrack, once created, stays registered for the rest of the call even
// after sharing stops (OnTrack fires only once per slot), so its mere
// existence must never be used to infer current activity.
func (p *Participant) SetSharingActive(active bool) {
	p.mu.Lock()
	p.sharingActive = active
	p.mu.Unlock()
}

func (p *Participant) IsSharingActive() bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.sharingActive
}

// GetScreenTracks returns this participant's screen-share tracks (video and/or
// audio), if any have ever been published this call.
func (p *Participant) GetScreenTracks() []*PublishedTrack {
	p.mu.RLock()
	defer p.mu.RUnlock()
	out := make([]*PublishedTrack, 0)
	for _, t := range p.tracks {
		if t.Role == RoleScreen {
			out = append(out, t)
		}
	}
	return out
}
