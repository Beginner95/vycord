package application

import (
	"log/slog"
	"sync"

	"github.com/pion/webrtc/v4"

	"github.com/vycord/server/internal/sfu/domain"
	sfuwebrtc "github.com/vycord/server/internal/sfu/infrastructure/webrtc"
)

// RoomSession manages all ParticipantSessions for one room.
// It is the central coordinator for track routing:
// when participant A publishes a new track, RoomSession adds it to all other
// participants' PCs, triggering renegotiation on each.
type RoomSession struct {
	room        *domain.Room
	peerFactory *sfuwebrtc.PeerFactory
	log         *slog.Logger

	mu       sync.RWMutex
	sessions map[string]*ParticipantSession // participantID → session
}

func NewRoomSession(room *domain.Room, peerFactory *sfuwebrtc.PeerFactory, log *slog.Logger) *RoomSession {
	return &RoomSession{
		room:        room,
		peerFactory: peerFactory,
		log:         log,
		sessions:    make(map[string]*ParticipantSession),
	}
}

// Join creates a new ParticipantSession, adds existing participants' tracks to its PC,
// and starts negotiation. It also delivers the new participant's future tracks to
// existing sessions.
func (rs *RoomSession) Join(
	participant *domain.Participant,
	sigSession SignalingSession,
) (*ParticipantSession, error) {
	pc, err := rs.peerFactory.NewPeerConnection()
	if err != nil {
		return nil, err
	}

	ps := NewParticipantSession(
		participant,
		pc,
		sigSession,
		rs.log,
		rs.onNewTrack, // called when this participant publishes a track
	)

	// Deliver all already-published tracks from existing participants.
	rs.mu.RLock()
	for _, existingSession := range rs.sessions {
		existingTracks := existingSession.Participant.GetTracks()
		rs.log.Info("existing participant tracks for new joiner",
			"room_id", rs.room.ID,
			"new_user_id", participant.UserID,
			"existing_user_id", existingSession.Participant.UserID,
			"track_count", len(existingTracks),
		)
		for _, track := range existingTracks {
			rs.log.Info("delivering existing track to new participant",
				"room_id", rs.room.ID,
				"new_user_id", participant.UserID,
				"track_owner", existingSession.Participant.UserID,
				"track_kind", track.Kind.String(),
				"track_id", track.ID,
				"stream_id", track.StreamID,
			)
			if err := ps.AddRemoteTrack(track); err != nil {
				rs.log.Warn("failed to add existing track to new participant",
					"new_user_id", participant.UserID,
					"track_owner", existingSession.Participant.UserID,
					"track_id", track.ID,
					"error", err,
				)
			}
		}
	}
	rs.mu.RUnlock()

	rs.mu.Lock()
	rs.sessions[participant.ID] = ps
	rs.mu.Unlock()

	if err := rs.room.AddParticipant(participant); err != nil {
		ps.Close()
		rs.mu.Lock()
		delete(rs.sessions, participant.ID)
		rs.mu.Unlock()
		return nil, err
	}

	ps.Start()

	// Watch for session termination to auto-clean up.
	go rs.watchSession(ps)

	rs.log.Info("participant joined room",
		"room_id", rs.room.ID,
		"user_id", participant.UserID,
		"participant_id", participant.ID,
	)

	return ps, nil
}

// Leave removes a participant and notifies remaining participants.
func (rs *RoomSession) Leave(participantID string) {
	rs.mu.Lock()
	ps, ok := rs.sessions[participantID]
	if ok {
		delete(rs.sessions, participantID)
	}
	rs.mu.Unlock()

	if !ok {
		return
	}

	ps.Close()
	rs.room.RemoveParticipant(participantID)

	rs.log.Info("participant left room",
		"room_id", rs.room.ID,
		"user_id", ps.Participant.UserID,
	)

	// Remove the departing participant's forwarded tracks from all remaining subscribers.
	// Without this, every reconnect leaves ghost RTPSenders in subscriber PCs, causing
	// m-line count to grow unboundedly and the SDP offer to accumulate stale m-sections.
	leavingTracks := ps.Participant.GetTracks()
	if len(leavingTracks) > 0 {
		rs.mu.RLock()
		for _, sub := range rs.sessions {
			for _, track := range leavingTracks {
				sub.RemoveRemoteTrack(track.ID)
			}
		}
		rs.mu.RUnlock()

		rs.log.Info("removed departed participant's tracks from subscribers",
			"room_id", rs.room.ID,
			"user_id", ps.Participant.UserID,
			"track_count", len(leavingTracks),
			"subscriber_count", func() int {
				rs.mu.RLock()
				defer rs.mu.RUnlock()
				return len(rs.sessions)
			}(),
		)
	}

	// Notify remaining participants.
	rs.broadcastEvent("participant_left", map[string]any{
		"user_id": ps.Participant.UserID,
	}, "")
}

// DeliverAnswer routes a client's SDP answer to their session.
func (rs *RoomSession) DeliverAnswer(participantID string, sdp webrtc.SessionDescription) {
	rs.mu.RLock()
	ps, ok := rs.sessions[participantID]
	rs.mu.RUnlock()
	if ok {
		ps.DeliverAnswer(sdp)
	}
}

// AddICECandidate routes a client ICE candidate to their session.
func (rs *RoomSession) AddICECandidate(participantID string, c webrtc.ICECandidateInit) {
	rs.mu.RLock()
	ps, ok := rs.sessions[participantID]
	rs.mu.RUnlock()
	if ok {
		if err := ps.AddICECandidate(c); err != nil {
			rs.log.Warn("failed to add ICE candidate",
				"participant_id", participantID,
				"error", err,
			)
		}
	}
}

// ExistingParticipants returns user IDs of all current participants.
func (rs *RoomSession) ExistingParticipants() []string {
	rs.mu.RLock()
	defer rs.mu.RUnlock()
	ids := make([]string, 0, len(rs.sessions))
	for _, ps := range rs.sessions {
		ids = append(ids, ps.Participant.UserID)
	}
	return ids
}

func (rs *RoomSession) Done() <-chan struct{} {
	return rs.room.Done()
}

func (rs *RoomSession) participantCount() int {
	rs.mu.RLock()
	defer rs.mu.RUnlock()
	return len(rs.sessions)
}

// --- internal ---

// onNewTrack is the callback from ParticipantSession when a publisher pushes a track.
// It starts RTP forwarding and delivers the track to all current subscribers.
//
// Concurrency note: we hold RLock only while iterating sessions. AddRemoteTrack
// calls pc.AddTrack internally which fires OnNegotiationNeeded → trigger(), a
// non-blocking channel send — safe under RLock.
func (rs *RoomSession) onNewTrack(
	publisher *domain.Participant,
	track *domain.PublishedTrack,
	remote *webrtc.TrackRemote,
) {
	rs.mu.RLock()
	publisherSession, hasPublisher := rs.sessions[publisher.ID]
	subscriberCount := len(rs.sessions) - 1
	rs.mu.RUnlock()

	rs.log.Info("new track, starting forwarding",
		"room_id", rs.room.ID,
		"publisher_id", publisher.UserID,
		"track_kind", track.Kind.String(),
		"track_id", track.ID,
		"subscribers", subscriberCount,
	)

	if hasPublisher {
		publisherSession.StartForwarding(track, remote)
	} else {
		rs.log.Warn("publisher session not found, cannot start forwarding",
			"publisher_id", publisher.ID,
		)
	}

	// Route track to all other participants. Each AddRemoteTrack triggers
	// OnNegotiationNeeded which enqueues a renegotiation for that subscriber.
	rs.mu.RLock()
	defer rs.mu.RUnlock()

	routed := 0
	for id, ps := range rs.sessions {
		if id == publisher.ID {
			continue
		}
		if err := ps.AddRemoteTrack(track); err != nil {
			rs.log.Warn("failed to route track to subscriber",
				"publisher_id", publisher.UserID,
				"subscriber_id", ps.Participant.UserID,
				"track_id", track.ID,
				"error", err,
			)
			continue
		}
		routed++
		rs.log.Debug("track routed to subscriber",
			"publisher_id", publisher.UserID,
			"subscriber_id", ps.Participant.UserID,
			"track_id", track.ID,
		)
	}

	rs.log.Info("track routing complete",
		"room_id", rs.room.ID,
		"publisher_id", publisher.UserID,
		"track_kind", track.Kind.String(),
		"routed_to", routed,
	)
}

// watchSession waits for a session to end (PC failed / client disconnected / ctx cancelled)
// and triggers cleanup. This handles the case where the PC dies before the WS closes.
func (rs *RoomSession) watchSession(ps *ParticipantSession) {
	<-ps.Done()
	rs.Leave(ps.Participant.ID)
}

// NotifyOthers sends an event to all participants except the one with excludeID.
func (rs *RoomSession) NotifyOthers(excludeParticipantID string, eventType string, payload any) {
	rs.broadcastEvent(eventType, payload, excludeParticipantID)
}

func (rs *RoomSession) broadcastEvent(eventType string, payload any, excludeParticipantID string) {
	rs.mu.RLock()
	defer rs.mu.RUnlock()

	for id, ps := range rs.sessions {
		if id == excludeParticipantID {
			continue
		}
		if err := ps.session.Notify(eventType, payload); err != nil {
			rs.log.Warn("failed to notify participant",
				"event", eventType,
				"participant_id", id,
				"error", err,
			)
		}
	}
}
