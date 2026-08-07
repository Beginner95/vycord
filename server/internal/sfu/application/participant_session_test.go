package application

import (
	"io"
	"log/slog"
	"testing"

	"github.com/pion/webrtc/v4"

	"github.com/vycord/server/internal/sfu/domain"
	sfuwebrtc "github.com/vycord/server/internal/sfu/infrastructure/webrtc"
)

// TestNewParticipantSessionCreatesFourTransceivers pins down the fixed
// transceiver order that RoomSession's Role resolution depends on:
// [0]=mic-audio, [1]=camera-video, [2]=screen-video, [3]=screen-audio.
func TestNewParticipantSessionCreatesFourTransceivers(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	pf, err := sfuwebrtc.NewPeerFactory([]string{}, "")
	if err != nil {
		t.Fatalf("NewPeerFactory: %v", err)
	}
	pc, err := pf.NewPeerConnection()
	if err != nil {
		t.Fatalf("NewPeerConnection: %v", err)
	}
	defer pc.Close()

	participant := domain.NewParticipant("p1", "alice", "room1")
	ps := NewParticipantSession(participant, pc, &fakeSignalingSession{}, log, nil)
	defer ps.Close()

	transceivers := pc.GetTransceivers()
	if len(transceivers) != 4 {
		t.Fatalf("transceiver count = %d, want 4 (mic-audio, camera-video, screen-video, screen-audio)", len(transceivers))
	}

	wantKinds := []webrtc.RTPCodecType{
		webrtc.RTPCodecTypeAudio,
		webrtc.RTPCodecTypeVideo,
		webrtc.RTPCodecTypeVideo,
		webrtc.RTPCodecTypeAudio,
	}
	for i, want := range wantKinds {
		if got := transceivers[i].Kind(); got != want {
			t.Fatalf("transceiver[%d].Kind() = %s, want %s", i, got, want)
		}
		if got := transceivers[i].Direction(); got != webrtc.RTPTransceiverDirectionRecvonly {
			t.Fatalf("transceiver[%d].Direction() = %s, want recvonly", i, got)
		}
	}
}
