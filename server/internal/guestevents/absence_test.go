package guestevents

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
)

type recordingSweeper struct {
	mu    sync.Mutex
	calls []map[uuid.UUID]struct{}
}

func (r *recordingSweeper) SweepAbsentGuests(present map[uuid.UUID]struct{}) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls = append(r.calls, present)
}
func (r *recordingSweeper) last() map[uuid.UUID]struct{} {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.calls) == 0 {
		return nil
	}
	return r.calls[len(r.calls)-1]
}

type stubGuestPresence struct{ guests map[uuid.UUID][]uuid.UUID }

func (s *stubGuestPresence) GuestPresence(context.Context) (map[uuid.UUID][]uuid.UUID, error) {
	return s.guests, nil
}

func TestRunAbsenceSweepUnionsGatewayAndSFU(t *testing.T) {
	onGateway, inSFU := uuid.New(), uuid.New()
	gw := newFakeGateway()
	gw.connected[onGateway] = uuid.New()
	sfu := &stubGuestPresence{guests: map[uuid.UUID][]uuid.UUID{uuid.New(): {inSFU}}}
	sweeper := &recordingSweeper{}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go RunAbsenceSweep(ctx, sweeper, gw, sfu, 5*time.Millisecond)

	assert.Eventually(t, func() bool {
		last := sweeper.last()
		if last == nil {
			return false
		}
		_, a := last[onGateway]
		_, b := last[inSFU]
		return a && b
	}, 2*time.Second, 5*time.Millisecond, "a guest counts as present on either side")
}
