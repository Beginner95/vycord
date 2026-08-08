package application

import (
	"context"
	"io"
	"log/slog"
	"sync"
	"time"

	"github.com/pion/rtcp"
	"github.com/pion/webrtc/v4"

	"github.com/vycord/server/internal/sfu/domain"
)

const (
	// maxPendingICECandidates caps the ICE candidate buffer to prevent unbounded
	// memory growth if a client sends candidates before the answer arrives.
	maxPendingICECandidates = 256

	// rtcpBufSize is the read buffer for RTCP packets from subscriber senders.
	rtcpBufSize = 1500

	// idleConnectionTimeout is how long we wait for the initial ICE connection
	// to complete. Clients that open WebSocket but never complete ICE (broken
	// client, DoS attempt, network partition) are evicted after this timeout.
	idleConnectionTimeout = 30 * time.Second

	// disconnectedTimeout is how long we tolerate ICE disconnection before
	// treating it as a failure. 30 seconds gives headroom for transient network
	// hiccups (WiFi reconnect, NAT rebinding, mobile handover) while still
	// cleaning up genuinely disconnected clients well before pion's ~60s timeout.
	disconnectedTimeout = 30 * time.Second
)

// keyframeRetryDelays is the back-off schedule for the keyframe-retry loop in
// RequestKeyframe. A single PLI travels over RTCP and can be dropped — most
// likely exactly when a screen share starts (resolution jump → a large keyframe
// split across many packets, higher odds the keyframe or the PLI is lost). When
// that one PLI is lost the viewer's decoder has nothing to recover from and stays
// black until something else happens to trigger a keyframe. So we re-send PLI on
// this schedule until forwardRTP confirms a fresh keyframe actually arrived
// (track.KeyframeArrivedSince), giving up after the last delay. Delays grow so we
// react fast at first but don't spam the publisher's encoder if it's genuinely
// not responding. Total budget ~2.4s.
var keyframeRetryDelays = []time.Duration{
	100 * time.Millisecond,
	200 * time.Millisecond,
	300 * time.Millisecond,
	600 * time.Millisecond,
	1200 * time.Millisecond,
}

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

	// timerMu guards the lifecycle timers below.
	timerMu sync.Mutex
	// idleTimer fires if the PC never reaches Connected within idleConnectionTimeout.
	idleTimer *time.Timer
	// disconnectTimer fires if ICE stays Disconnected longer than disconnectedTimeout.
	disconnectTimer *time.Timer

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

	// Add recvonly transceivers so these appear in the first SDP offer the server
	// creates. Without them, the client has no hint to send audio/video.
	//
	// Fixed, deterministic order — resolveTrackRole (below) and the client's
	// createPeerConnection() both depend on this exact sequence:
	//   [0] audio — microphone
	//   [1] video — camera
	//   [2] video — screen-share video (dummy track until sharing starts)
	//   [3] audio — screen-share audio (dummy track until sharing starts)
	// Both screen slots are pre-provisioned at join time (never added later) so
	// that starting/stopping a share is a plain replaceTrack on the client,
	// with no renegotiation required — the same trick already used for the
	// camera/no-camera dummy track.
	transceiverKinds := []webrtc.RTPCodecType{
		webrtc.RTPCodecTypeAudio,
		webrtc.RTPCodecTypeVideo,
		webrtc.RTPCodecTypeVideo,
		webrtc.RTPCodecTypeAudio,
	}
	for _, kind := range transceiverKinds {
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

// resolveTrackRole identifies which of the 4 pre-created transceiver slots a
// publisher's incoming track belongs to, based on its fixed creation position
// (see the comment in NewParticipantSession). Index 2 (screen-video) and index
// 3 (screen-audio) are RoleScreen; everything else is RoleCameraOrMic.
func (ps *ParticipantSession) resolveTrackRole(receiver *webrtc.RTPReceiver) domain.TrackRole {
	for i, t := range ps.pc.GetTransceivers() {
		if t.Receiver() != receiver {
			continue
		}
		if i == 2 || i == 3 {
			return domain.RoleScreen
		}
		return domain.RoleCameraOrMic
	}
	return domain.RoleCameraOrMic
}

// Start launches the negotiation loop and sends the initial offer to the client.
// It also starts an idle timer: if the PC hasn't reached Connected within
// idleConnectionTimeout, the session is cancelled (evicts unresponsive clients).
func (ps *ParticipantSession) Start() {
	go ps.neg.Run(ps.ctx)
	ps.neg.trigger()

	ps.timerMu.Lock()
	ps.idleTimer = time.AfterFunc(idleConnectionTimeout, func() {
		ps.log.Warn("idle connection timeout: PC never reached Connected, closing session",
			"user_id", ps.Participant.UserID,
			"timeout", idleConnectionTimeout,
		)
		ps.cancel()
	})
	ps.timerMu.Unlock()
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
		if len(ps.pendingICE) < maxPendingICECandidates {
			ps.pendingICE = append(ps.pendingICE, c)
		} else {
			ps.log.Warn("pendingICE buffer full, dropping candidate",
				"user_id", ps.Participant.UserID,
				"buffer_size", maxPendingICECandidates,
			)
		}
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
//
// Idempotent per track ID: a second call for a track this subscriber already
// receives is a no-op. Without the guard pion would create a second, independent
// RTPSender for the same LocalTrack while sendersByTrackID keeps only the last
// one — RemoveRemoteTrack could then never detach the first, leaving RTP
// flowing past the subscription gate forever.
func (ps *ParticipantSession) AddRemoteTrack(t *domain.PublishedTrack) error {
	// The check and the pc.AddTrack that satisfies it happen under one lock:
	// with two lock sections, two concurrent callers (e.g. WatchShare racing
	// SetSharingActive for the same publisher) would each see "not forwarded"
	// and each create a sender. pc.AddTrack only fires OnNegotiationNeeded →
	// a non-blocking channel send, so it is safe to call under sendersMu.
	ps.sendersMu.Lock()
	if _, alreadyForwarded := ps.sendersByTrackID[t.ID]; alreadyForwarded {
		ps.sendersMu.Unlock()
		ps.log.Debug("AddRemoteTrack: track already forwarded to subscriber, skipping",
			"subscriber_user_id", ps.Participant.UserID,
			"track_id", t.ID,
		)
		return nil
	}

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
		ps.sendersMu.Unlock()
		ps.log.Error("AddRemoteTrack: pc.AddTrack failed",
			"subscriber_user_id", ps.Participant.UserID,
			"track_id", t.ID,
			"error", err,
		)
		return err
	}

	ps.sendersByTrackID[t.ID] = sender
	bindedSenders := len(ps.sendersByTrackID)
	ps.sendersMu.Unlock()

	// Read RTCP from the subscriber's sender in a goroutine.
	// This is required for two reasons:
	//   1. pion's NACK responder interceptor only retransmits packets when RTCP
	//      flows through the interceptor pipeline via sender.Read(). Without this,
	//      NACK retransmissions are silently dropped → packet loss stays unrecovered.
	//   2. PLI (Picture Loss Indication) requests from the subscriber must be
	//      forwarded to the publisher so they produce a new keyframe.
	go ps.readSubscriberRTCP(ps.ctx, sender, t)

	// Request a keyframe from the publisher immediately when a subscriber is added.
	// Without this, the first subscriber has to wait for a naturally-occurring
	// keyframe from the publisher (can take seconds), causing video to appear
	// frozen until the first I-frame arrives.
	if t.Kind == domain.TrackKindVideo && t.SendPLI != nil {
		t.SendPLI()
	}

	ps.log.Info("AddRemoteTrack: track bound to subscriber PC",
		"subscriber_user_id", ps.Participant.UserID,
		"track_id", t.ID,
		"publisher_stream_id", t.StreamID,
		"track_kind", t.Kind.String(),
		"sender_ssrc", sender.Track().StreamID(),
		"total_forwarded_tracks_for_subscriber", bindedSenders,
	)

	return nil
}

// RequestKeyframe forces a fresh keyframe for every video track this participant
// publishes. Called when the client explicitly signals that its video source just
// changed (e.g. replaceTrack from camera to screen capture) — that switch doesn't
// renegotiate, so without this push the SFU has no way to know a new keyframe is
// needed and recovery would depend entirely on a subscriber's decoder noticing the
// bad frame and emitting its own PLI via the (passive, less reliable) RTCP path in
// readSubscriberRTCP.
//
// A single PLI is not reliable (RTCP is droppable, and the start of a screen share
// is exactly when loss is most likely), so each track's request is handled by a
// background retry loop that re-sends PLI until forwardRTP confirms a real keyframe
// landed. Returns immediately; the loops run on their own goroutines.
//
// When no video tracks are registered yet (common for audio-only joiners or users
// with video disabled: pion's OnTrack hasn't fired because no RTP arrived yet),
// a background goroutine retries once after 500ms — by that time the first RTP
// packet from the client's screen track will have arrived and OnTrack fired.
func (ps *ParticipantSession) RequestKeyframe() {
	tracks := ps.Participant.GetTracks()
	started := 0
	for _, t := range tracks {
		if t.Kind != domain.TrackKindVideo || t.SendPLI == nil {
			continue
		}
		go ps.ensureKeyframe(t)
		started++
	}

	if started > 0 {
		return
	}

	// No video tracks yet. The client most likely just called replaceTrack
	// (screen share start) before the first RTP packet reached pion and
	// triggered OnTrack. Wait briefly for OnTrack to fire, then retry.
	ps.log.Info("RequestKeyframe: no video tracks yet, retrying after 500ms",
		"user_id", ps.Participant.UserID,
	)
	go func() {
		select {
		case <-ps.ctx.Done():
			return
		case <-time.After(500 * time.Millisecond):
		}
		for _, t := range ps.Participant.GetTracks() {
			if t.Kind == domain.TrackKindVideo && t.SendPLI != nil {
				go ps.ensureKeyframe(t)
			}
		}
	}()
}

// ensureKeyframe re-sends PLI for a single video track until a fresh keyframe is
// observed in the publisher's stream or the retry schedule is exhausted. Only one
// loop runs per track at a time (TryAcquireKeyframeLoop); overlapping requests are
// coalesced into the in-flight loop, which already covers them.
func (ps *ParticipantSession) ensureKeyframe(t *domain.PublishedTrack) {
	if !t.TryAcquireKeyframeLoop() {
		// A loop is already chasing a keyframe for this track; it covers us too.
		return
	}
	defer t.ReleaseKeyframeLoop()

	requestedAt := time.Now()
	ps.log.Info("RequestKeyframe: starting keyframe retry loop",
		"user_id", ps.Participant.UserID,
		"track_id", t.ID,
	)

	for attempt, delay := range keyframeRetryDelays {
		t.SendPLI() // also records MarkPLIRequested internally

		select {
		case <-ps.ctx.Done():
			return
		case <-time.After(delay):
		}

		if t.KeyframeArrivedSince(requestedAt) {
			ps.log.Info("RequestKeyframe: keyframe confirmed",
				"user_id", ps.Participant.UserID,
				"track_id", t.ID,
				"attempts", attempt+1,
				"elapsed_ms", time.Since(requestedAt).Milliseconds(),
			)
			return
		}
	}

	// Exhausted the schedule without seeing a keyframe. The publisher's encoder
	// either isn't responding or the stream is idle/paused; subscribers' own
	// passive PLI path remains as a last resort.
	ps.log.Warn("RequestKeyframe: no keyframe after retries",
		"user_id", ps.Participant.UserID,
		"track_id", t.ID,
		"attempts", len(keyframeRetryDelays),
		"elapsed_ms", time.Since(requestedAt).Milliseconds(),
	)
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
	go ps.forwardRTP(ps.ctx, remote, track)
}

// Close stops all goroutines and closes the PeerConnection.
func (ps *ParticipantSession) Close() {
	ps.stopTimers()
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

func (ps *ParticipantSession) handleRemoteTrack(remote *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
	codec := remote.Codec()
	role := ps.resolveTrackRole(receiver)
	// A client can negotiate its screen video onto the camera's m-line (positional
	// role inference below then mislabels it as camera). Use the explicit screen
	// track id from screen_share_start as the authoritative signal when present.
	if ps.Participant.IsScreenTrackID(remote.ID()) {
		role = domain.RoleScreen
	}
	ps.log.Info("publisher track arrived",
		"user_id", ps.Participant.UserID,
		"kind", remote.Kind().String(),
		"track_id", remote.ID(),
		"stream_id", remote.StreamID(),
		"ssrc", remote.SSRC(),
		"codec_mime", codec.MimeType,
		"codec_clock_rate", codec.ClockRate,
		"codec_channels", codec.Channels,
		"codec_fmtp", codec.SDPFmtpLine,
		"role", role.String(),
	)

	streamID := ps.Participant.UserID
	if role == domain.RoleScreen {
		// Distinct StreamID lets subscribers tell a screen track apart from
		// camera/mic on the wire (both share the publisher's UserID otherwise) —
		// see RTCTrackEvent.streams[0].id on the client.
		streamID += ":screen"
	}
	track, err := domain.NewPublishedTrack(remote, streamID, role)
	if err != nil {
		ps.log.Error("failed to wrap published track", "error", err)
		return
	}

	ps.log.Info("published track created",
		"local_track_id", track.ID,
		"local_track_stream_id", track.StreamID,
		"local_track_kind", track.Kind.String(),
	)

	// Wire PLI forwarding: when any subscriber experiences packet loss and sends
	// PLI feedback, we forward it to the publisher so they produce a new keyframe.
	// Capturing remote.SSRC() here is safe — it's immutable after OnTrack fires.
	publisherSSRC := remote.SSRC()
	track.SendPLI = func() {
		track.MarkPLIRequested()
		if err := ps.pc.WriteRTCP([]rtcp.Packet{
			&rtcp.PictureLossIndication{MediaSSRC: uint32(publisherSSRC)},
		}); err != nil {
			ps.log.Warn("failed to send PLI to publisher",
				"user_id", ps.Participant.UserID,
				"track_id", remote.ID(),
				"error", err,
			)
			return
		}
		// Info, not Debug: this is the one line that proves the SFU actually asked
		// the publisher for a keyframe. Cross-reference with "forwarded keyframe"
		// in forwardRTP (by track_id) to see whether the publisher responded and
		// how long it took — that's the key diagnostic for the black-screen reports.
		ps.log.Info("PLI sent to publisher",
			"user_id", ps.Participant.UserID,
			"track_id", remote.ID(),
		)
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

	switch state {
	case webrtc.PeerConnectionStateConnected:
		// Cancel the idle timer — ICE connected in time.
		ps.timerMu.Lock()
		if ps.idleTimer != nil {
			ps.idleTimer.Stop()
			ps.idleTimer = nil
		}
		// If we had a disconnect timer running, cancel it too.
		if ps.disconnectTimer != nil {
			ps.disconnectTimer.Stop()
			ps.disconnectTimer = nil
		}
		ps.timerMu.Unlock()

	case webrtc.PeerConnectionStateDisconnected:
		// ICE temporarily lost connectivity (network switch, NAT rebinding).
		// Start a timer: if not reconnected within disconnectedTimeout, treat
		// as failed. pion's own ICE timers will also fire, but this gives us
		// faster application-level cleanup with logging.
		ps.timerMu.Lock()
		if ps.disconnectTimer == nil {
			ps.disconnectTimer = time.AfterFunc(disconnectedTimeout, func() {
				ps.log.Warn("ICE disconnected timeout exceeded, closing session",
					"user_id", ps.Participant.UserID,
					"timeout", disconnectedTimeout,
				)
				ps.cancel()
			})
		}
		ps.timerMu.Unlock()

	case webrtc.PeerConnectionStateFailed, webrtc.PeerConnectionStateClosed:
		ps.stopTimers()
		ps.cancel()
	}
}

func (ps *ParticipantSession) stopTimers() {
	ps.timerMu.Lock()
	defer ps.timerMu.Unlock()
	if ps.idleTimer != nil {
		ps.idleTimer.Stop()
		ps.idleTimer = nil
	}
	if ps.disconnectTimer != nil {
		ps.disconnectTimer.Stop()
		ps.disconnectTimer = nil
	}
}

// readSubscriberRTCP reads RTCP feedback from a subscriber's RTPSender and
// forwards PLI requests to the publisher.
//
// This goroutine serves two purposes:
//  1. pion's interceptors (NACK responder) need the RTCP pipeline to be drained
//     via sender.Read(). Without this loop, NACK retransmissions silently fail.
//  2. PLI (Picture Loss Indication) from the subscriber is forwarded to the
//     publisher so they generate a new keyframe, recovering from packet loss.
//
// The loop exits when ctx is cancelled (session ends) or when the sender is
// closed (publisher left and the track was removed via pc.RemoveTrack).
func (ps *ParticipantSession) readSubscriberRTCP(
	ctx context.Context,
	sender *webrtc.RTPSender,
	track *domain.PublishedTrack,
) {
	buf := make([]byte, rtcpBufSize)
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		n, _, err := sender.Read(buf)
		if err != nil {
			if err == io.EOF || err == io.ErrClosedPipe {
				return
			}
			// Transient read error (e.g. io.ErrShortBuffer) — buffer stays open, keep reading.
			ps.log.Debug("RTCP sender read error",
				"subscriber_user_id", ps.Participant.UserID,
				"track_id", track.ID,
				"error", err,
			)
			continue
		}
		if n == 0 {
			continue
		}

		pkts, err := rtcp.Unmarshal(buf[:n])
		if err != nil {
			ps.log.Debug("failed to unmarshal RTCP from subscriber",
				"subscriber_user_id", ps.Participant.UserID,
				"track_id", track.ID,
				"error", err,
			)
			continue
		}

		for _, pkt := range pkts {
			switch pkt.(type) {
			case *rtcp.PictureLossIndication, *rtcp.FullIntraRequest:
				// Forward PLI to publisher so they produce a new keyframe.
				if track.SendPLI != nil {
					track.SendPLI()
				}
			}
		}
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
	track *domain.PublishedTrack,
) {
	local := track.LocalTrack
	ps.log.Info("RTP forwarding started",
		"user_id", ps.Participant.UserID,
		"kind", remote.Kind().String(),
		"track_id", remote.ID(),
		"stream_id", remote.StreamID(),
		"mime_type", track.MimeType,
	)
	defer ps.log.Info("RTP forwarding stopped",
		"user_id", ps.Participant.UserID,
		"kind", remote.Kind().String(),
		"track_id", remote.ID(),
	)

	buf := make([]byte, 1500)
	var pktCount int64
	var writeErrCount int64
	var keyframeCount int64
	var lastKeyframeAt time.Time

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

		// Detect actual keyframes in the publisher's video bitstream. This serves
		// two purposes: (1) it closes the loop for the keyframe-retry mechanism in
		// RequestKeyframe — MarkKeyframeReceived lets a retry loop stop once a fresh
		// keyframe has demonstrably arrived; (2) the log line lets us tell, from
		// logs alone, "publisher never sent a keyframe" apart from "keyframe was
		// sent but lost/never decoded downstream" — the core screen-share question.
		if track.Kind == domain.TrackKindVideo && detectKeyframe(track.MimeType, buf[:n]) {
			track.MarkKeyframeReceived()
			keyframeCount++
			now := time.Now()
			var sinceLastKeyframeMs int64 = -1
			if !lastKeyframeAt.IsZero() {
				sinceLastKeyframeMs = now.Sub(lastKeyframeAt).Milliseconds()
			}
			lastKeyframeAt = now
			fields := []any{
				"user_id", ps.Participant.UserID,
				"track_id", remote.ID(),
				"keyframe_count", keyframeCount,
				"since_last_keyframe_ms", sinceLastKeyframeMs,
				"packets_forwarded", pktCount,
			}
			if sincePLI, ok := track.TimeSinceLastPLIRequest(); ok {
				fields = append(fields, "since_pli_request_ms", sincePLI.Milliseconds())
			}
			ps.log.Info("forwarded keyframe from publisher", fields...)
		}

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
				"remote_ssrc", remote.SSRC(),
				"subscriber_bound_senders", len(ps.sendersByTrackID),
			)
		}
	}
}
