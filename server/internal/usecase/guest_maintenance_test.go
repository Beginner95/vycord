package usecase_test

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"

	"github.com/vycord/server/internal/usecase"
)

type countingMaintainer struct{ lobby, calls atomic.Int32 }

func (c *countingMaintainer) ExpireLobby()            { c.lobby.Add(1) }
func (c *countingMaintainer) EndGuestsOfClosedCalls() { c.calls.Add(1) }

func TestRunGuestMaintenance(t *testing.T) {
	m := &countingMaintainer{}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go usecase.RunGuestMaintenance(ctx, m, 5*time.Millisecond)

	assert.Eventually(t, func() bool { return m.lobby.Load() > 0 && m.calls.Load() > 0 },
		2*time.Second, 5*time.Millisecond)

	cancel()
	settled := m.lobby.Load()
	time.Sleep(50 * time.Millisecond)
	assert.Equal(t, settled, m.lobby.Load(), "a cancelled context stops the loop")
}
