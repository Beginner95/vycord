package domain

import (
	"sync"
	"sync/atomic"

	"github.com/pion/webrtc/v4"
)

const (
	// audioSinkQueueSize is how many packets may sit queued for one subscriber's
	// audio — 50 Opus packets is one second. Big enough to ride out a momentary
	// write stall, small enough that a subscriber who genuinely cannot keep up
	// loses packets instead of accruing seconds of stale audio to play late.
	audioSinkQueueSize = 50

	// videoSinkQueueSize is deliberately much larger: video is bursty, a single
	// keyframe alone can be dozens of packets, and dropping the FRONT of one
	// corrupts the subscriber's decoder rather than costing it a moment of sound.
	// ~250 packets is roughly a second of a 2.5 Mbps screen share.
	videoSinkQueueSize = 250
)

// TrackFanout delivers one publisher's RTP to each subscriber independently.
//
// It exists because the obvious approach — one shared TrackLocalStaticRTP added
// to every subscriber's PeerConnection — makes pion's writeRTP walk every binding
// serially, synchronously, inside the publisher's read goroutine. One subscriber
// whose write blocks therefore stalls that goroutine; pion then buffers the
// publisher's stream (up to 1MB, minutes of Opus, with no time bound) and hands
// the whole backlog over the moment the goroutine resumes — measured at ~31x real
// time. Every listener of that publisher gets an oversized jitter buffer at once
// and their NetEq time-compresses to drain it: the "that person suddenly sounds
// sped up" report (VYC-70 bug 1).
//
// Here each subscriber gets its own TrackLocalStaticRTP fed by its own bounded
// queue and goroutine. Write never blocks, so the publisher's reader stays at the
// live edge and no backlog can form; a subscriber who falls behind drops packets
// from its own queue and affects nobody else.
type TrackFanout struct {
	codec     webrtc.RTPCodecCapability
	trackID   string
	streamID  string
	queueSize int

	mu     sync.RWMutex
	sinks  map[string]*subscriberSink
	closed bool
}

type subscriberSink struct {
	queue   chan []byte
	done    chan struct{}
	dropped atomic.Int64
}

func NewTrackFanout(
	codec webrtc.RTPCodecCapability,
	trackID, streamID string,
	kind TrackKind,
) *TrackFanout {
	queueSize := audioSinkQueueSize
	if kind == TrackKindVideo {
		queueSize = videoSinkQueueSize
	}
	return &TrackFanout{
		codec:     codec,
		trackID:   trackID,
		streamID:  streamID,
		queueSize: queueSize,
		sinks:     make(map[string]*subscriberSink),
	}
}

// AddSink creates this subscriber's own forwarding track and starts its writer.
// The returned track is what the caller adds to that subscriber's PeerConnection.
//
// A subscriber that already has a sink gets ErrSinkExists rather than a second
// queue and goroutine: callers already dedupe (AddRemoteTrack), so reaching here
// twice is a bug worth surfacing, not something to paper over.
func (f *TrackFanout) AddSink(subscriberID string) (*webrtc.TrackLocalStaticRTP, error) {
	track, err := webrtc.NewTrackLocalStaticRTP(f.codec, f.trackID, f.streamID)
	if err != nil {
		return nil, err
	}
	// Write errors are deliberately swallowed: a transient SRTP failure for this
	// subscriber must not stop its stream, and it can no longer affect anyone else.
	if err := f.addSinkWithWriter(subscriberID, func(b []byte) { _, _ = track.Write(b) }); err != nil {
		return nil, err
	}
	return track, nil
}

// addSinkWithWriter is the seam AddSink is built on: it owns the queue and the
// writer goroutine, independent of where the bytes ultimately go.
func (f *TrackFanout) addSinkWithWriter(subscriberID string, write func([]byte)) error {
	sink := &subscriberSink{
		queue: make(chan []byte, f.queueSize),
		done:  make(chan struct{}),
	}

	// Existence check and registration under ONE write lock: with two sections two
	// concurrent calls would each see "absent" and the loser's goroutine would be
	// stranded outside the map, never stopped.
	f.mu.Lock()
	if f.closed {
		f.mu.Unlock()
		return ErrFanoutClosed
	}
	if _, exists := f.sinks[subscriberID]; exists {
		f.mu.Unlock()
		return ErrSinkExists
	}
	f.sinks[subscriberID] = sink
	f.mu.Unlock()

	go func() {
		for {
			select {
			case <-sink.done:
				return
			case b := <-sink.queue:
				write(b)
			}
		}
	}()
	return nil
}

// RemoveSink stops delivery to a subscriber and releases its goroutine.
func (f *TrackFanout) RemoveSink(subscriberID string) {
	f.mu.Lock()
	sink, ok := f.sinks[subscriberID]
	if ok {
		delete(f.sinks, subscriberID)
	}
	f.mu.Unlock()

	if ok {
		close(sink.done)
	}
}

// Write hands one RTP packet to every subscriber. It never blocks: a subscriber
// whose queue is full loses its OLDEST queued packet.
//
// Drop-oldest is deliberate for BOTH kinds, for different reasons. For audio the
// freshest sound is the useful one, and keeping stale packets only pushes that
// subscriber further behind. For video any overflow already corrupts the frame in
// flight — dropping from either end truncates it — so the tie is broken the same
// way, by keeping the subscriber closest to live. The decoder recovers on its
// own: a corrupted frame makes the subscriber emit PLI, which readSubscriberRTCP
// forwards to the publisher. Deliberately no keyframe request from here: there is
// one encoder per publisher, so a PLI driven by one struggling subscriber would
// force a keyframe on every viewer — and keyframes are the largest bursts, which
// would overflow that subscriber again. That is exactly the cross-subscriber
// coupling this type exists to remove.
//
// pkt is copied once and shared read-only by all sinks — callers pass their
// reusable read buffer.
func (f *TrackFanout) Write(pkt []byte) {
	f.mu.RLock()
	if len(f.sinks) == 0 || f.closed {
		f.mu.RUnlock()
		return
	}
	buf := make([]byte, len(pkt))
	copy(buf, pkt)

	for _, sink := range f.sinks {
		select {
		case sink.queue <- buf:
		default:
			select {
			case <-sink.queue:
			default:
			}
			select {
			case sink.queue <- buf:
			default:
			}
			sink.dropped.Add(1)
		}
	}
	f.mu.RUnlock()
}

// Dropped reports how many packets a subscriber lost to queue overflow.
func (f *TrackFanout) Dropped(subscriberID string) int64 {
	f.mu.RLock()
	defer f.mu.RUnlock()
	if sink, ok := f.sinks[subscriberID]; ok {
		return sink.dropped.Load()
	}
	return 0
}

// TotalDropped reports overflow drops across all current subscribers.
func (f *TrackFanout) TotalDropped() int64 {
	f.mu.RLock()
	defer f.mu.RUnlock()
	var total int64
	for _, sink := range f.sinks {
		total += sink.dropped.Load()
	}
	return total
}

func (f *TrackFanout) SinkCount() int {
	f.mu.RLock()
	defer f.mu.RUnlock()
	return len(f.sinks)
}

// Close stops every sink. Called when the publisher's track ends.
func (f *TrackFanout) Close() {
	f.mu.Lock()
	if f.closed {
		f.mu.Unlock()
		return
	}
	f.closed = true
	sinks := make([]*subscriberSink, 0, len(f.sinks))
	for id, sink := range f.sinks {
		sinks = append(sinks, sink)
		delete(f.sinks, id)
	}
	f.mu.Unlock()

	for _, sink := range sinks {
		close(sink.done)
	}
}

// WireID is the id every subscriber's forwarding track for this publisher track
// is advertised with. Session-scoped, so a dead session's track and the live
// one's stay distinguishable on the wire — see localTrackID.
func (f *TrackFanout) WireID() string {
	return f.trackID
}

// HasSink reports whether this subscriber currently has a sink.
func (f *TrackFanout) HasSink(subscriberID string) bool {
	f.mu.RLock()
	defer f.mu.RUnlock()
	_, ok := f.sinks[subscriberID]
	return ok
}
