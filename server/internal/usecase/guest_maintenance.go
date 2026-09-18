package usecase

import (
	"context"
	"time"
)

// GuestMaintainer — то, что делает фоновая уборка гостей. Узкий интерфейс
// вместо domain.GuestUseCase: цикл ничего больше не умеет вызвать.
type GuestMaintainer interface {
	ExpireLobby()
	EndGuestsOfClosedCalls()
}

// RunGuestMaintenance раз в interval снимает зависших в лобби и гасит гостей
// закрытых звонков. Запускается из main.go на фоновом контексте.
func RunGuestMaintenance(ctx context.Context, m GuestMaintainer, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			m.ExpireLobby()
			m.EndGuestsOfClosedCalls()
		}
	}
}
