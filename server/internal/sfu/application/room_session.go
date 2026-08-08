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
	// watchers maps a publisher's participantID to the set of subscriber
	// participantIDs currently watching their screen share. Only screen-role
	// tracks are gated by this — camera/mic keep broadcasting to everyone.
	watchers map[string]map[string]bool
}

func NewRoomSession(room *domain.Room, peerFactory *sfuwebrtc.PeerFactory, log *slog.Logger) *RoomSession {
	return &RoomSession{
		room:        room,
		peerFactory: peerFactory,
		log:         log,
		sessions:    make(map[string]*ParticipantSession),
		watchers:    make(map[string]map[string]bool),
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

	// A reconnecting user may still have a stale session here: after a network
	// change the old WS hangs half-open until disconnectedTimeout, its tracks
	// keep being forwarded and other participants see a duplicate. The stale
	// scan, its removal from the map and the registration of the new session
	// happen under one write lock: with separate lock sections two concurrent
	// joins of the same user (double-click, overlapping reconnect attempts)
	// would each miss the other and leave two live sessions in the room.
	rs.mu.Lock()
	var stale *ParticipantSession
	for id, s := range rs.sessions {
		if s.Participant.UserID == participant.UserID {
			stale = s
			delete(rs.sessions, id)
			break
		}
	}

	// Deliver all already-published tracks from existing participants
	// (the stale session is already removed, so its dying tracks are skipped).
	//
	// Screen-role tracks are deliberately excluded here: they are gated by the
	// watch subscription and must ONLY ever reach a subscriber through
	// WatchShare (or the SetSharingActive(true) push to existing watchers). A
	// new joiner has, by definition, not watched anything yet — delivering a
	// publisher's screen slots at join time would bypass the gate entirely and
	// (because the screen-audio dummy slot is live from join onward) silently
	// subscribe every late joiner to every other participant's future share.
	for _, existingSession := range rs.sessions {
		existingTracks := existingSession.Participant.GetTracks()
		rs.log.Info("existing participant tracks for new joiner",
			"room_id", rs.room.ID,
			"new_user_id", participant.UserID,
			"existing_user_id", existingSession.Participant.UserID,
			"track_count", len(existingTracks),
		)
		for _, track := range existingTracks {
			if track.Role == domain.RoleScreen {
				rs.log.Info("skipping screen track for new joiner (watch-gated)",
					"room_id", rs.room.ID,
					"new_user_id", participant.UserID,
					"track_owner", existingSession.Participant.UserID,
					"track_id", track.ID,
				)
				continue
			}
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

	rs.sessions[participant.ID] = ps
	rs.mu.Unlock()

	// The new participant is added to the domain room BEFORE the stale one is
	// removed, so a solo reconnect no longer empties (and thereby closes) the
	// room between the two steps — the ErrRoomClosed retry in RoomManager.Join
	// remains only as a safety net.
	addErr := rs.room.AddParticipant(participant)

	if stale != nil {
		rs.log.Info("evicting stale session for reconnecting user",
			"room_id", rs.room.ID,
			"user_id", participant.UserID,
			"stale_participant_id", stale.Participant.ID,
		)
		// Tell the old client its session was superseded: it must NOT
		// auto-rejoin, otherwise two devices of one user evict each other in an
		// endless ping-pong. Best effort — the socket may already be gone.
		_ = stale.session.Notify("session_replaced", map[string]any{
			"room_id": rs.room.ID,
		})
		rs.finishLeave(stale)
	}

	if addErr != nil {
		ps.Close()
		rs.mu.Lock()
		if cur, ok := rs.sessions[participant.ID]; ok && cur == ps {
			delete(rs.sessions, participant.ID)
		}
		rs.mu.Unlock()
		return nil, addErr
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
		// The session may have been evicted from the map while its own Join was
		// still registering the participant in the domain room (concurrent
		// same-user joins). Its watchSession lands here — make sure no ghost
		// participant stays behind. Idempotent for already-removed IDs.
		rs.room.RemoveParticipant(participantID)
		return
	}

	rs.finishLeave(ps)
}

// finishLeave tears down a session already removed from rs.sessions: closes it,
// removes it from the domain room, cleans its forwarded tracks out of the
// remaining subscribers and notifies them. Must be called without rs.mu held.
func (rs *RoomSession) finishLeave(ps *ParticipantSession) {
	ps.Close()
	rs.room.RemoveParticipant(ps.Participant.ID)

	rs.mu.Lock()
	delete(rs.watchers, ps.Participant.ID)
	for _, subs := range rs.watchers {
		delete(subs, ps.Participant.ID)
	}
	rs.mu.Unlock()

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

// ExistingSharingPeers returns the user IDs of every participant whose
// sharingActive flag is set — i.e. who is screen-sharing RIGHT NOW. This is the
// authoritative snapshot of active shares (as opposed to the existence of a
// screen track, which persists for the rest of the call even after sharing
// stops). It is included in the 'joined' notification so a participant who joins
// or reconnects mid-share can surface the Watch button instead of relying on the
// fire-and-forget app-WS 'screen_share_started' broadcast, which late joiners always miss.
func (rs *RoomSession) ExistingSharingPeers() []string {
	rs.mu.RLock()
	defer rs.mu.RUnlock()
	out := make([]string, 0)
	for _, ps := range rs.sessions {
		if ps.Participant.IsSharingActive() {
			out = append(out, ps.Participant.UserID)
		}
	}
	return out
}

// WatchShare registers subscriberParticipantID as watching targetUserID's
// screen share. If a share is currently active, the subscriber immediately
// receives the current screen tracks — this is the primary delivery path from
// the 2nd share of a call onward, since onNewTrack's routing only ever fires
// once per screen slot (see the architecture note in the design doc).
func (rs *RoomSession) WatchShare(subscriberParticipantID, targetUserID string) {
	rs.mu.Lock()
	subscriberPS, subOK := rs.sessions[subscriberParticipantID]
	publisherID, publisher, pubOK := rs.findByUserIDLocked(targetUserID)
	if !subOK || !pubOK {
		rs.mu.Unlock()
		rs.log.Warn("watch_share: subscriber or target not found",
			"subscriber_participant_id", subscriberParticipantID,
			"target_user_id", targetUserID,
		)
		return
	}

	// Already watching: a duplicate watch_share (client retry, overlapping
	// focus transitions) must be a no-op. Re-running the forwarding below
	// would ask pion for a SECOND RTPSender bound to the same LocalTrack;
	// UnwatchShare/RemoveRemoteTrack only ever drops the sender currently in
	// sendersByTrackID, so the first one would keep pushing RTP forever with
	// no way to remove it — an unbounded leak past the subscription gate.
	if rs.watchers[publisherID][subscriberParticipantID] {
		rs.mu.Unlock()
		return
	}

	if rs.watchers[publisherID] == nil {
		rs.watchers[publisherID] = make(map[string]bool)
	}
	rs.watchers[publisherID][subscriberParticipantID] = true

	var screenTracks []*domain.PublishedTrack
	if publisher.IsSharingActive() {
		screenTracks = publisher.GetScreenTracks()
	}
	rs.mu.Unlock()

	for _, tr := range screenTracks {
		if err := subscriberPS.AddRemoteTrack(tr); err != nil {
			rs.log.Warn("watch_share: failed to forward existing screen track",
				"subscriber_participant_id", subscriberParticipantID,
				"target_user_id", targetUserID,
				"track_id", tr.ID,
				"error", err,
			)
		}
	}
}

// UnwatchShare removes subscriberParticipantID from targetUserID's watcher set
// and removes any screen tracks currently forwarded to the subscriber.
func (rs *RoomSession) UnwatchShare(subscriberParticipantID, targetUserID string) {
	rs.mu.Lock()
	subscriberPS, subOK := rs.sessions[subscriberParticipantID]
	publisherID, publisher, pubOK := rs.findByUserIDLocked(targetUserID)
	if !subOK || !pubOK {
		rs.mu.Unlock()
		return
	}
	if watchers, ok := rs.watchers[publisherID]; ok {
		delete(watchers, subscriberParticipantID)
	}
	rs.mu.Unlock()

	for _, tr := range publisher.GetScreenTracks() {
		subscriberPS.RemoveRemoteTrack(tr.ID)
	}
}

// SetSharingActive records whether publisherParticipantID is currently screen
// sharing. On deactivation it forcibly drops forwarding for every current
// watcher and clears the watcher set entirely — regardless of whether the
// subscribers' own unwatch_share arrives — so a later watch_share for the same
// publisher starts from a clean slate instead of silently reusing a stale
// subscription from a previous share session.
//
// On activation it pushes the publisher's current screen tracks to everyone
// already registered as a watcher. Without this, a subscriber that registered
// before the flag flipped (a watch_share/screen_share_start race, or the
// reconnect-restore path) would never receive anything: onNewTrack fires only
// once per transceiver slot, so from the 2nd share of a call onward there is no
// other delivery trigger.
func (rs *RoomSession) SetSharingActive(publisherParticipantID string, active bool) {
	rs.mu.Lock()
	ps, ok := rs.sessions[publisherParticipantID]
	if !ok {
		rs.mu.Unlock()
		return
	}
	ps.Participant.SetSharingActive(active)

	if active {
		screenTracks := ps.Participant.GetScreenTracks()
		watchers := rs.watchers[publisherParticipantID]
		subs := make([]*ParticipantSession, 0, len(watchers))
		for subID := range watchers {
			if sub, ok := rs.sessions[subID]; ok {
				subs = append(subs, sub)
			}
		}
		rs.mu.Unlock()

		// AddRemoteTrack is idempotent per track ID, so a watcher that already
		// received this track (e.g. via WatchShare moments earlier) is a no-op
		// rather than a duplicate sender.
		for _, sub := range subs {
			for _, tr := range screenTracks {
				if err := sub.AddRemoteTrack(tr); err != nil {
					rs.log.Warn("screen_share_start: failed to forward screen track to existing watcher",
						"publisher_participant_id", publisherParticipantID,
						"subscriber_user_id", sub.Participant.UserID,
						"track_id", tr.ID,
						"error", err,
					)
				}
			}
		}
		return
	}

	watchers := rs.watchers[publisherParticipantID]
	delete(rs.watchers, publisherParticipantID)
	screenTracks := ps.Participant.GetScreenTracks()
	subs := make([]*ParticipantSession, 0, len(watchers))
	for subID := range watchers {
		if sub, ok := rs.sessions[subID]; ok {
			subs = append(subs, sub)
		}
	}
	rs.mu.Unlock()

	for _, sub := range subs {
		for _, tr := range screenTracks {
			sub.RemoveRemoteTrack(tr.ID)
		}
	}
}

// findByUserIDLocked looks up a session by the participant's UserID (as
// opposed to the internal participantID keying rs.sessions). Callers targeting
// another participant only know them by UserID (that's all the client ever
// exposes). Must be called with rs.mu held (read or write).
func (rs *RoomSession) findByUserIDLocked(userID string) (participantID string, participant *domain.Participant, ok bool) {
	for id, s := range rs.sessions {
		if s.Participant.UserID == userID {
			return id, s.Participant, true
		}
	}
	return "", nil, false
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

	// Route track to subscribers. Camera/mic broadcast to everyone, as before.
	// Screen-role tracks are gated: only participants already watching this
	// publisher (via WatchShare) get them. This branch only matters for the
	// very first share of a call — OnTrack fires once per transceiver slot,
	// so subsequent share sessions are delivered entirely through WatchShare/
	// SetSharingActive instead (see the architecture note in the design doc).
	rs.mu.RLock()
	defer rs.mu.RUnlock()

	if track.Role == domain.RoleScreen {
		routed := 0
		for subscriberID := range rs.watchers[publisher.ID] {
			ps, ok := rs.sessions[subscriberID]
			if !ok {
				continue
			}
			if err := ps.AddRemoteTrack(track); err != nil {
				rs.log.Warn("failed to route screen track to watcher",
					"publisher_id", publisher.UserID,
					"subscriber_id", ps.Participant.UserID,
					"track_id", track.ID,
					"error", err,
				)
				continue
			}
			routed++
		}
		rs.log.Info("screen track routing complete",
			"room_id", rs.room.ID,
			"publisher_id", publisher.UserID,
			"track_kind", track.Kind.String(),
			"routed_to", routed,
		)
		return
	}

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
