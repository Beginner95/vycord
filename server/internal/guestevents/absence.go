package guestevents

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// absenceFetchTimeout bounds one /guest-presence call.
const absenceFetchTimeout = 5 * time.Second

type AbsenceSweeper interface {
	SweepAbsentGuests(present map[uuid.UUID]struct{})
}

type GuestPresenceSource interface {
	GuestPresence(ctx context.Context) (map[uuid.UUID][]uuid.UUID, error)
}

// RunAbsenceSweep periodically tells the use case who is still here. "Here"
// means connected to the gateway OR present in the SFU: a guest whose page is
// alive but whose media died is still in the call, and vice versa.
func RunAbsenceSweep(ctx context.Context, sweeper AbsenceSweeper, gw GatewayPort, sfu GuestPresenceSource, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			present := make(map[uuid.UUID]struct{})
			for guestID := range gw.Connected() {
				present[guestID] = struct{}{}
			}
			if sfu != nil {
				fetchCtx, cancel := context.WithTimeout(ctx, absenceFetchTimeout)
				rooms, err := sfu.GuestPresence(fetchCtx)
				cancel()
				if err == nil {
					for _, guests := range rooms {
						for _, guestID := range guests {
							present[guestID] = struct{}{}
						}
					}
				}
			}
			sweeper.SweepAbsentGuests(present)
		}
	}
}
