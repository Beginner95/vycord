package domain

import (
	"sync"
	"sync/atomic"
	"time"

	"github.com/pion/webrtc/v4"
)

type TrackKind int

const (
	TrackKindAudio TrackKind = iota
	TrackKindVideo
)

func (k TrackKind) String() string {
	if k == TrackKindAudio {
		return "audio"
	}
	return "video"
}

// TrackRole distinguishes a participant's camera/microphone tracks (always
// broadcast to every other participant) from their screen-share tracks
// (forwarded only to subscribers who explicitly watch, see RoomSession.WatchShare).
type TrackRole int

const (
	RoleCameraOrMic TrackRole = iota
	RoleScreen
)

func (r TrackRole) String() string {
	if r == RoleScreen {
		return "screen"
	}
	return "camera_or_mic"
}

// PublishedTrack is the server-side forwarding track for one publisher's stream.
// StreamID equals the publisher's UserID so subscribers can identify the source
// via RTCTrackEvent.streams[0].id.
type PublishedTrack struct {
	ID         string
	StreamID   string
	Kind       TrackKind
	Role       TrackRole
	MimeType   string // e.g. "video/VP8", "video/H264" — used for keyframe-detection diagnostics.
	LocalTrack *webrtc.TrackLocalStaticRTP

	// SendPLI forwards a Picture Loss Indication to the publisher, requesting
	// a keyframe. Set by ParticipantSession after the track is created.
	// Called when any subscriber sends PLI feedback via RTCP.
	SendPLI func()

	// pliMu guards lastPLIRequestedAt and lastKeyframeAt below.
	pliMu              sync.Mutex
	lastPLIRequestedAt time.Time
	lastKeyframeAt     time.Time

	// keyframeLoopActive is set while a keyframe-retry loop is already running for
	// this track, so concurrent RequestKeyframe calls don't stack up overlapping
	// PLI bursts (e.g. start-share + a subscriber's own PLI arriving at once).
	keyframeLoopActive atomic.Bool
}

func NewPublishedTrack(remote *webrtc.TrackRemote, streamID string, role TrackRole) (*PublishedTrack, error) {
	local, err := webrtc.NewTrackLocalStaticRTP(
		remote.Codec().RTPCodecCapability,
		remote.ID(),
		streamID,
	)
	if err != nil {
		return nil, err
	}

	kind := TrackKindAudio
	if remote.Kind() == webrtc.RTPCodecTypeVideo {
		kind = TrackKindVideo
	}

	return &PublishedTrack{
		ID:         remote.ID(),
		StreamID:   streamID,
		Kind:       kind,
		Role:       role,
		MimeType:   remote.Codec().MimeType,
		LocalTrack: local,
	}, nil
}

// MarkPLIRequested records that a PLI/keyframe request was just sent for this
// track. Diagnostic only — lets forwardRTP log how long it took for an actual
// keyframe to show up in the publisher's RTP stream after the request, which is
// exactly the question that matters for the screen-share black-screen bug.
func (t *PublishedTrack) MarkPLIRequested() {
	t.pliMu.Lock()
	t.lastPLIRequestedAt = time.Now()
	t.pliMu.Unlock()
}

// TimeSinceLastPLIRequest reports how long ago MarkPLIRequested was last called.
// ok is false if no PLI has been requested yet for this track.
func (t *PublishedTrack) TimeSinceLastPLIRequest() (d time.Duration, ok bool) {
	t.pliMu.Lock()
	defer t.pliMu.Unlock()
	if t.lastPLIRequestedAt.IsZero() {
		return 0, false
	}
	return time.Since(t.lastPLIRequestedAt), true
}

// MarkKeyframeReceived records that an actual keyframe was just observed in the
// publisher's RTP stream (detected in forwardRTP). This closes the loop on a
// keyframe request: a retry loop can stop hammering PLI once a fresh keyframe
// has demonstrably arrived.
func (t *PublishedTrack) MarkKeyframeReceived() {
	t.pliMu.Lock()
	t.lastKeyframeAt = time.Now()
	t.pliMu.Unlock()
}

// KeyframeArrivedSince reports whether a keyframe has been observed at or after
// the given instant — i.e. whether a keyframe requested at `since` has landed.
func (t *PublishedTrack) KeyframeArrivedSince(since time.Time) bool {
	t.pliMu.Lock()
	defer t.pliMu.Unlock()
	return !t.lastKeyframeAt.IsZero() && !t.lastKeyframeAt.Before(since)
}

// TryAcquireKeyframeLoop returns true if the caller may start a keyframe-retry
// loop for this track, claiming exclusive ownership. It returns false if a loop
// is already running, in which case the caller must not start another. Pair every
// successful acquire with ReleaseKeyframeLoop.
func (t *PublishedTrack) TryAcquireKeyframeLoop() bool {
	return t.keyframeLoopActive.CompareAndSwap(false, true)
}

// ReleaseKeyframeLoop releases ownership claimed by TryAcquireKeyframeLoop.
func (t *PublishedTrack) ReleaseKeyframeLoop() {
	t.keyframeLoopActive.Store(false)
}
