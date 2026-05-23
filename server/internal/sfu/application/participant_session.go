package application

import (
	"context"
	"log/slog"
	"sync"

	"github.com/pion/webrtc/v4"

	"github.com/vycord/server/internal/sfu/domain"
)

// ParticipantSession owns the PeerConnection lifecycle for one participant.
//
// Responsibilities:
//   - trickle ICE exchange
//   - receiving publisher tracks (handleRemoteTrack → onTrack callback)
//   - forwarding remote participant tracks to this subscriber
//   - serialized renegotiation via negotiator
type ParticipantSession struct {
	Participant *domain.Participant
	pc          *webrtc.PeerConnection
	neg         *negotiator
	session     SignalingSession
	log         *slog.Logger

	ctx    context.Context
	cancel context.CancelFunc

	// ICE candidates buffered before the first SetRemoteDescription(answer).
	// readPump delivers candidates synchronously while the negotiate() goroutine
	// is still calling SetRemoteDescription — buffering prevents "remote description
	// is not set" errors from pion.
	pendingICE []webrtc.ICECandidateInit
	iceMu      sync.Mutex

	// sendersByTrackID tracks the RTPSender returned by pc.AddTrack for each forwarded
	// remote track. Required for RemoveRemoteTrack: pion needs the exact sender object.
	sendersByTrackID map[string]*webrtc.RTPSender
	sendersMu        sync.Mutex

	// onTrack is invoked by the room session whenever this participant publishes a new track.
	onTrack func(p *domain.Participant, track *domain.PublishedTrack, remote *webrtc.TrackRemote)
}

func NewParticipantSession(
	participant *domain.Participant,
	pc *webrtc.PeerConnection,
	session SignalingSession,
	log *slog.Logger,
	onTrack func(*domain.Participant, *domain.PublishedTrack, *webrtc.TrackRemote),
) *ParticipantSession {
	ctx, cancel := context.WithCancel(session.Context())

	ps := &ParticipantSession{
		Participant:      participant,
		pc:               pc,
		session:          session,
		log:              log,
		ctx:              ctx,
		cancel:           cancel,
		onTrack:          onTrack,
		sendersByTrackID: make(map[string]*webrtc.RTPSender),
	}

	ps.neg = newNegotiator(pc, session, log)
	ps.neg.onAnswerApplied = ps.flushPendingICE

	pc.OnICECandidate(ps.handleICECandidate)
	pc.OnTrack(ps.handleRemoteTrack)
	pc.OnConnectionStateChange(ps.handleConnectionState)

	// Add recvonly transceivers so these appear in the first SDP offer the server creates.
	// Without them, the client has no hint to send audio/video.
	for _, kind := range []webrtc.RTPCodecType{webrtc.RTPCodecTypeAudio, webrtc.RTPCodecTypeVideo} {
		if _, err := pc.AddTransceiverFromKind(kind, webrtc.RTPTransceiverInit{
			Direction: webrtc.RTPTransceiverDirectionRecvonly,
		}); err != nil {
			log.Error("failed to add recvonly transceiver",
				"user_id", participant.UserID,
				"kind", kind.String(),
				"error", err,
			)
		}
	}

	return ps
}

// Start launches the negotiation loop and sends the initial offer to the client.
func (ps *ParticipantSession) Start() {
	go ps.neg.Run(ps.ctx)
	ps.neg.trigger()
}

// DeliverAnswer feeds the client's SDP answer to the pending negotiation.
func (ps *ParticipantSession) DeliverAnswer(sdp webrtc.SessionDescription) {
	ps.neg.DeliverAnswer(sdp)
}

// AddICECandidate delivers a client-side ICE candidate to pion.
// Candidates that arrive before SetRemoteDescription(answer) are buffered and
// flushed by flushPendingICE once the answer has been applied. This avoids
// "remote description is not set" errors caused by readPump racing the negotiate
// goroutine when the client sends ICE candidates simultaneously with its answer.
func (ps *ParticipantSession) AddICECandidate(c webrtc.ICECandidateInit) error {
	ps.iceMu.Lock()
	defer ps.iceMu.Unlock()
	if ps.pc.RemoteDescription() == nil {
		ps.pendingICE = append(ps.pendingICE, c)
		return nil
	}
	return ps.pc.AddICECandidate(c)
}

// flushPendingICE adds all buffered ICE candidates now that SetRemoteDescription
// has been called. Called by the negotiator after processing each answer.
func (ps *ParticipantSession) flushPendingICE() {
	ps.iceMu.Lock()
	pending := ps.pendingICE
	ps.pendingICE = nil
	ps.iceMu.Unlock()

	for _, c := range pending {
		if err := ps.pc.AddICECandidate(c); err != nil {
			ps.log.Warn("failed to add buffered ICE candidate",
				"user_id", ps.Participant.UserID,
				"error", err,
			)
		}
	}
}

// AddRemoteTrack adds another participant's forwarding track to this subscriber's PC.
// Triggers OnNegotiationNeeded → renegotiation automatically.
func (ps *ParticipantSession) AddRemoteTrack(t *domain.PublishedTrack) error {
	ps.log.Info("AddRemoteTrack: adding forwarded track to subscriber PC",
		"subscriber_user_id", ps.Participant.UserID,
		"publisher_stream_id", t.StreamID,
		"track_kind", t.Kind.String(),
		"track_id", t.ID,
		"pc_signaling_state", ps.pc.SignalingState().String(),
		"pc_connection_state", ps.pc.ConnectionState().String(),
	)
	sender, err := ps.pc.AddTrack(t.LocalTrack)
	if err != nil {
		ps.log.Error("AddRemoteTrack: pc.AddTrack failed",
			"subscriber_user_id", ps.Participant.UserID,
			"track_id", t.ID,
			"error", err,
		)
		return err
	}

	ps.sendersMu.Lock()
	ps.sendersByTrackID[t.ID] = sender
	ps.sendersMu.Unlock()

	return nil
}

// RemoveRemoteTrack removes a previously-forwarded track from this subscriber's PC.
// Called when the publisher leaves so their m-lines are cleaned up and don't accumulate.
func (ps *ParticipantSession) RemoveRemoteTrack(trackID string) {
	ps.sendersMu.Lock()
	sender, ok := ps.sendersByTrackID[trackID]
	if ok {
		delete(ps.sendersByTrackID, trackID)
	}
	ps.sendersMu.Unlock()

	if !ok {
		return
	}

	if err := ps.pc.RemoveTrack(sender); err != nil {
		ps.log.Warn("RemoveRemoteTrack: pc.RemoveTrack failed",
			"subscriber_user_id", ps.Participant.UserID,
			"track_id", trackID,
			"error", err,
		)
		return
	}

	ps.log.Info("RemoveRemoteTrack: track removed from subscriber PC",
		"subscriber_user_id", ps.Participant.UserID,
		"track_id", trackID,
	)
}

// StartForwarding launches the RTP copying goroutine for a published track.
// Must be called after domain.PublishedTrack is created from the TrackRemote.
func (ps *ParticipantSession) StartForwarding(track *domain.PublishedTrack, remote *webrtc.TrackRemote) {
	go ps.forwardRTP(ps.ctx, remote, track.LocalTrack)
}

// Close stops all goroutines and closes the PeerConnection.
func (ps *ParticipantSession) Close() {
	ps.cancel()
	ps.pc.Close()
}

func (ps *ParticipantSession) Done() <-chan struct{} {
	return ps.ctx.Done()
}

// --- internal handlers ---

func (ps *ParticipantSession) handleICECandidate(c *webrtc.ICECandidate) {
	if c == nil {
		return
	}
	init := c.ToJSON()
	if err := ps.session.SendICECandidate(&init); err != nil {
		ps.log.Warn("failed to send ICE candidate",
			"user_id", ps.Participant.UserID,
			"error", err,
		)
	}
}

func (ps *ParticipantSession) handleRemoteTrack(remote *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
	ps.log.Info("publisher track arrived",
		"user_id", ps.Participant.UserID,
		"kind", remote.Kind().String(),
		"track_id", remote.ID(),
	)

	track, err := domain.NewPublishedTrack(remote, ps.Participant.UserID)
	if err != nil {
		ps.log.Error("failed to wrap published track", "error", err)
		return
	}

	ps.Participant.AddTrack(track)

	if ps.onTrack != nil {
		ps.onTrack(ps.Participant, track, remote)
	}
}

func (ps *ParticipantSession) handleConnectionState(state webrtc.PeerConnectionState) {
	ps.log.Info("connection state changed",
		"user_id", ps.Participant.UserID,
		"state", state.String(),
	)
	if state == webrtc.PeerConnectionStateFailed || state == webrtc.PeerConnectionStateClosed {
		ps.cancel()
	}
}

// forwardRTP copies RTP packets from a remote (publisher) track to a local
// (forwarding) track. It must only exit when:
//   - ctx is cancelled (publisher left or session closed)
//   - remote.Read returns an error (source track ended)
//
// Write errors from local.Write are intentionally ignored: TrackLocalStaticRTP
// writes to ALL bound subscriber PeerConnections. If one subscriber's SRTP
// context has a transient error (e.g. DTLS race on first bind), pion still
// delivers the packet to all other subscribers and returns a non-nil error.
// Exiting here would kill audio for everyone, not just the failing subscriber.
func (ps *ParticipantSession) forwardRTP(
	ctx context.Context,
	remote *webrtc.TrackRemote,
	local *webrtc.TrackLocalStaticRTP,
) {
	ps.log.Info("RTP forwarding started",
		"user_id", ps.Participant.UserID,
		"kind", remote.Kind().String(),
		"track_id", remote.ID(),
		"stream_id", remote.StreamID(),
	)
	defer ps.log.Info("RTP forwarding stopped",
		"user_id", ps.Participant.UserID,
		"kind", remote.Kind().String(),
		"track_id", remote.ID(),
	)

	buf := make([]byte, 1500)
	var pktCount int64
	var writeErrCount int64

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		n, _, err := remote.Read(buf)
		if err != nil {
			// Source track ended (publisher closed PC, network loss, etc.).
			// This is the only legitimate reason to stop forwarding.
			ps.log.Warn("publisher track read error — forwarding stopped",
				"user_id", ps.Participant.UserID,
				"track_id", remote.ID(),
				"packets_forwarded", pktCount,
				"write_errors", writeErrCount,
				"error", err,
			)
			return
		}

		pktCount++

		if _, err := local.Write(buf[:n]); err != nil {
			// A subscriber had a transient write error.
			// pion already wrote to all other subscribers successfully.
			writeErrCount++
			ps.log.Warn("subscriber write error (forwarding continues)",
				"user_id", ps.Participant.UserID,
				"track_id", remote.ID(),
				"kind", remote.Kind().String(),
				"packets_forwarded", pktCount,
				"write_errors", writeErrCount,
				"error", err,
			)
			// Do NOT return here. Continue forwarding to healthy subscribers.
		}

		// Log RTP flow milestones so we can confirm audio is actually reaching pion.
		// First packet is critical — confirms ICE+DTLS+SRTP established for publisher.
		// Subsequent milestones (50, 200, 1000) confirm sustained flow.
		if pktCount == 1 || pktCount == 50 || pktCount == 200 || pktCount == 1000 || pktCount%5000 == 0 {
			ps.log.Info("RTP forwarding milestone",
				"user_id", ps.Participant.UserID,
				"kind", remote.Kind().String(),
				"track_id", remote.ID(),
				"packets_forwarded", pktCount,
				"write_errors", writeErrCount,
			)
		}
	}
}
