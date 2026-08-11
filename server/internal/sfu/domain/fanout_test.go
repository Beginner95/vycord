package domain

import (
	"sync"
	"testing"
	"time"

	"github.com/pion/webrtc/v4"
)

func testFanout(t *testing.T) *TrackFanout {
	t.Helper()
	return NewTrackFanout(
		webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeOpus, ClockRate: 48000, Channels: 2},
		"alice-mic-p1", "alice", TrackKindAudio,
	)
}

// collectingWriter records what a subscriber actually received, and can be held
// up to model a subscriber whose SRTP/ICE write blocks.
type collectingWriter struct {
	mu      sync.Mutex
	got     int
	release chan struct{}
}

func (w *collectingWriter) write([]byte) {
	if w.release != nil {
		<-w.release
	}
	w.mu.Lock()
	w.got++
	w.mu.Unlock()
}

func (w *collectingWriter) count() int {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.got
}

// The guarantee the whole design rests on: writing to the fan-out must never
// block on a subscriber. Before this, TrackLocalStaticRTP.writeRTP wrote to every
// binding serially inside the publisher's read goroutine, so one stuck subscriber
// stalled that goroutine — pion then piled up a multi-second backlog that got
// forwarded to EVERY listener faster than real time (VYC-70 bug 1).
func TestFanoutWriteDoesNotBlockOnStuckSubscriber(t *testing.T) {
	f := testFanout(t)
	stuck := &collectingWriter{release: make(chan struct{})}
	f.addSinkWithWriter("bob", stuck.write)
	defer close(stuck.release)
	defer f.Close()

	done := make(chan struct{})
	go func() {
		for i := 0; i < 500; i++ {
			f.Write([]byte{byte(i)})
		}
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Write blocked on a stuck subscriber")
	}
}

// A stuck subscriber must not cost the healthy ones anything.
func TestFanoutHealthySubscriberUnaffectedByStuckOne(t *testing.T) {
	f := testFanout(t)
	defer f.Close()

	stuck := &collectingWriter{release: make(chan struct{})}
	healthy := &collectingWriter{}
	f.addSinkWithWriter("bob", stuck.write)
	f.addSinkWithWriter("carol", healthy.write)
	defer close(stuck.release)

	// Exactly one queue's worth: this fits without overflow regardless of how
	// promptly the consumer goroutine is scheduled, so anything missing here is
	// the stuck subscriber interfering rather than a legitimate burst drop
	// (which TestFanoutDropsForOverflowingSubscriberOnly covers).
	packets := f.queueSize
	for i := 0; i < packets; i++ {
		f.Write([]byte{byte(i)})
	}

	deadline := time.After(2 * time.Second)
	for healthy.count() < packets {
		select {
		case <-deadline:
			t.Fatalf("healthy subscriber got %d/%d packets while another was stuck",
				healthy.count(), packets)
		case <-time.After(10 * time.Millisecond):
		}
	}
}

// Overflow is bounded and counted: a subscriber that cannot keep up loses
// packets rather than growing an unbounded queue of stale audio.
func TestFanoutDropsForOverflowingSubscriberOnly(t *testing.T) {
	f := testFanout(t)
	defer f.Close()

	stuck := &collectingWriter{release: make(chan struct{})}
	healthy := &collectingWriter{}
	f.addSinkWithWriter("bob", stuck.write)
	f.addSinkWithWriter("carol", healthy.write)
	defer close(stuck.release)

	// Paced, like real RTP (which arrives every 20ms): a healthy subscriber keeps
	// up and never overflows, while the stuck one fills its queue and starts
	// losing packets. An unpaced loop would outrun every consumer and prove
	// nothing about isolation.
	for i := 0; i < f.queueSize*4; i++ {
		f.Write([]byte{byte(i)})
		time.Sleep(time.Millisecond)
	}

	if got := f.Dropped("bob"); got == 0 {
		t.Fatal("overflowing subscriber recorded no drops")
	}
	if got := f.Dropped("carol"); got != 0 {
		t.Fatalf("healthy subscriber recorded %d drops, want 0", got)
	}
}

// Removing a subscriber must stop delivery and release its goroutine.
func TestFanoutRemoveSinkStopsDelivery(t *testing.T) {
	f := testFanout(t)
	defer f.Close()

	w := &collectingWriter{}
	f.addSinkWithWriter("bob", w.write)

	f.Write([]byte{1})
	deadline := time.After(time.Second)
	for w.count() == 0 {
		select {
		case <-deadline:
			t.Fatal("subscriber never received the first packet")
		case <-time.After(5 * time.Millisecond):
		}
	}

	f.RemoveSink("bob")
	before := w.count()
	for i := 0; i < 50; i++ {
		f.Write([]byte{byte(i)})
	}
	time.Sleep(50 * time.Millisecond)

	if after := w.count(); after != before {
		t.Fatalf("removed subscriber received %d more packets", after-before)
	}
	if n := f.SinkCount(); n != 0 {
		t.Fatalf("SinkCount is %d after removing the only sink", n)
	}
}

// The packet handed to Write is the forwarder's reusable read buffer, so the
// fan-out must not let subscribers observe a later packet's bytes.
func TestFanoutDoesNotAliasCallerBuffer(t *testing.T) {
	f := testFanout(t)
	defer f.Close()

	var mu sync.Mutex
	var seen [][]byte
	f.addSinkWithWriter("bob", func(b []byte) {
		mu.Lock()
		seen = append(seen, b)
		mu.Unlock()
	})

	buf := make([]byte, 1)
	for i := 1; i <= 3; i++ {
		buf[0] = byte(i)
		f.Write(buf)
	}

	deadline := time.After(time.Second)
	for {
		mu.Lock()
		n := len(seen)
		mu.Unlock()
		if n == 3 {
			break
		}
		select {
		case <-deadline:
			t.Fatalf("only %d of 3 packets delivered", n)
		case <-time.After(5 * time.Millisecond):
		}
	}

	mu.Lock()
	defer mu.Unlock()
	for i, b := range seen {
		if b[0] != byte(i+1) {
			t.Fatalf("packet %d has byte %d, want %d — the caller's buffer was aliased",
				i, b[0], i+1)
		}
	}
}

// A closed fan-out must refuse new subscribers instead of handing back a track
// nothing will ever feed. forwardRTP closes the fan-out when the publisher's
// track ends, but the session stays routable until its teardown goroutine runs —
// so a join landing in that window would otherwise be told it subscribed
// successfully and get a permanently dead m-line.
func TestFanoutAddSinkFailsOnClosedFanout(t *testing.T) {
	f := testFanout(t)
	f.Close()

	track, err := f.AddSink("bob")
	if err == nil {
		t.Fatalf("AddSink succeeded on a closed fan-out, returning track %v", track)
	}
	if f.HasSink("bob") {
		t.Fatal("closed fan-out registered a sink")
	}
}

// Callers dedupe before reaching AddSink, so a second call is a bug — it must be
// reported rather than stranding the first sink's goroutine outside the map.
func TestFanoutDuplicateAddSinkKeepsSingleSink(t *testing.T) {
	f := testFanout(t)
	defer f.Close()

	if _, err := f.AddSink("bob"); err != nil {
		t.Fatalf("first AddSink: %v", err)
	}
	if _, err := f.AddSink("bob"); err == nil {
		t.Fatal("second AddSink for the same subscriber succeeded")
	}
	if got := f.SinkCount(); got != 1 {
		t.Fatalf("SinkCount is %d after a duplicate AddSink, want 1", got)
	}
}

// Video is not audio: a single keyframe can be dozens of packets, so a queue
// sized for one second of Opus would throw away the front of a keyframe the
// moment a subscriber's socket backs up.
func TestFanoutVideoQueueIsLargerThanAudio(t *testing.T) {
	audio := NewTrackFanout(
		webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeOpus, ClockRate: 48000},
		"t", "s", TrackKindAudio,
	)
	video := NewTrackFanout(
		webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeVP8, ClockRate: 90000},
		"t", "s", TrackKindVideo,
	)

	if video.queueSize <= audio.queueSize {
		t.Fatalf("video queue is %d packets, audio %d — video must be larger",
			video.queueSize, audio.queueSize)
	}
}
