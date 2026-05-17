package domain

import "github.com/pion/webrtc/v4"

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

// PublishedTrack is the server-side forwarding track for one publisher's stream.
// StreamID equals the publisher's UserID so subscribers can identify the source
// via RTCTrackEvent.streams[0].id.
type PublishedTrack struct {
	ID         string
	StreamID   string
	Kind       TrackKind
	LocalTrack *webrtc.TrackLocalStaticRTP
}

func NewPublishedTrack(remote *webrtc.TrackRemote, streamID string) (*PublishedTrack, error) {
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
		LocalTrack: local,
	}, nil
}
