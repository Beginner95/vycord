package domain

type EventKind string

const (
	EventParticipantJoined EventKind = "participant_joined"
	EventParticipantLeft   EventKind = "participant_left"
	EventTrackPublished    EventKind = "track_published"
	EventTrackRemoved      EventKind = "track_removed"
)

type Event struct {
	Kind          EventKind
	RoomID        string
	ParticipantID string
	UserID        string
	Track         *PublishedTrack // non-nil for track_published / track_removed
}
