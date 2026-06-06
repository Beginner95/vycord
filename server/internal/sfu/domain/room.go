package domain

import "sync"

// Room is the aggregate root for a group call session.
// It is deliberately thin: no PeerConnection logic, no IO.
type Room struct {
	ID string

	mu           sync.RWMutex
	participants map[string]*Participant
	closed       bool
	doneCh       chan struct{}

	onEvent func(Event)
}

func NewRoom(id string, onEvent func(Event)) *Room {
	return &Room{
		ID:           id,
		participants: make(map[string]*Participant),
		doneCh:       make(chan struct{}),
		onEvent:      onEvent,
	}
}

func (r *Room) AddParticipant(p *Participant) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return ErrRoomClosed
	}
	if _, exists := r.participants[p.ID]; exists {
		return ErrParticipantExists
	}
	r.participants[p.ID] = p
	return nil
}

// RemoveParticipant removes a participant and closes the room when it becomes empty.
// Returns the removed participant and whether it was found.
func (r *Room) RemoveParticipant(id string) (*Participant, bool) {
	r.mu.Lock()
	p, ok := r.participants[id]
	if ok {
		delete(r.participants, id)
	}
	empty := len(r.participants) == 0
	r.mu.Unlock()

	if ok && empty {
		r.mu.Lock()
		if !r.closed {
			r.closed = true
			close(r.doneCh)
		}
		r.mu.Unlock()
	}
	return p, ok
}

func (r *Room) GetParticipant(id string) (*Participant, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	p, ok := r.participants[id]
	return p, ok
}

// GetOthers returns all participants except the one with excludeID.
func (r *Room) GetOthers(excludeID string) []*Participant {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]*Participant, 0, len(r.participants))
	for id, p := range r.participants {
		if id != excludeID {
			out = append(out, p)
		}
	}
	return out
}

func (r *Room) GetAll() []*Participant {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]*Participant, 0, len(r.participants))
	for _, p := range r.participants {
		out = append(out, p)
	}
	return out
}

func (r *Room) Emit(e Event) {
	if r.onEvent != nil {
		r.onEvent(e)
	}
}

// Done returns a channel closed when the room becomes empty and is shut down.
func (r *Room) Done() <-chan struct{} {
	return r.doneCh
}
