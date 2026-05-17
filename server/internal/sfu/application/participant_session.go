package application

import (
	"context"
	"log/slog"

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
		Participant: participant,
		pc:          pc,
		session:     session,
		log:         log,
		ctx:         ctx,
		cancel:      cancel,
		onTrack:     onTrack,
	}

	ps.neg = newNegotiator(pc, session, log)

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
func (ps *ParticipantSession) AddICECandidate(c webrtc.ICECandidateInit) error {
	return ps.pc.AddICECandidate(c)
}

// AddRemoteTrack adds another participant's forwarding track to this subscriber's PC.
// Triggers OnNegotiationNeeded → renegotiation automatically.
func (ps *ParticipantSession) AddRemoteTrack(t *domain.PublishedTrack) error {
	_, err := ps.pc.AddTrack(t.LocalTrack)
	return err
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
// (forwarding) track. It runs until ctx is cancelled or the remote track ends.
// NACK/PLI are handled transparently by pion's default interceptors.
func (ps *ParticipantSession) forwardRTP(
	ctx context.Context,
	remote *webrtc.TrackRemote,
	local *webrtc.TrackLocalStaticRTP,
) {
	buf := make([]byte, 1500)
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		n, _, err := remote.Read(buf)
		if err != nil {
			ps.log.Debug("track read ended",
				"user_id", ps.Participant.UserID,
				"track_id", remote.ID(),
				"error", err,
			)
			return
		}

		if _, err := local.Write(buf[:n]); err != nil {
			ps.log.Debug("track write failed",
				"user_id", ps.Participant.UserID,
				"track_id", remote.ID(),
				"error", err,
			)
			return
		}
	}
}
