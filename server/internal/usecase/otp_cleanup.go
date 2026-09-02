package usecase

import (
	"context"
	"log/slog"
	"time"

	"github.com/vycord/server/internal/domain"
)

// expiredCodeRetention — сколько истёкшие коды ещё лежат в таблице после
// протухания. Сутки, а не ноль: строка мертва для аутентификации сразу по
// expires_at, но участвует в часовом лимите (CountIssuedSince) и полезна при
// разборе жалоб «код не приходил».
const expiredCodeRetention = 24 * time.Hour

// OTPCleaner убирает две независимые вещи: протухшие коды и брошенные
// регистрации. Второе обязательно — неподтверждённая запись навсегда
// удерживает username и email через UNIQUE, и настоящий владелец адреса не
// сможет зарегистрироваться.
type OTPCleaner struct {
	otpRepo       domain.OTPRepository
	userRepo      domain.UserRepository
	unverifiedTTL time.Duration
	log           *slog.Logger
}

func NewOTPCleaner(otpRepo domain.OTPRepository, userRepo domain.UserRepository, unverifiedTTL time.Duration, log *slog.Logger) *OTPCleaner {
	return &OTPCleaner{otpRepo: otpRepo, userRepo: userRepo, unverifiedTTL: unverifiedTTL, log: log}
}

// RunOnce выполняет обе уборки. Ошибка одной не отменяет другую: это
// независимые задачи, и падение первой не повод копить мусор по второй.
func (c *OTPCleaner) RunOnce() {
	now := time.Now()

	if removed, err := c.otpRepo.DeleteExpiredBefore(now.Add(-expiredCodeRetention)); err != nil {
		c.log.Error("otp cleanup failed", "error", err)
	} else if removed > 0 {
		c.log.Info("otp cleanup", "removed_codes", removed)
	}

	if removed, err := c.userRepo.DeleteUnverifiedBefore(now.Add(-c.unverifiedTTL)); err != nil {
		c.log.Error("unverified users cleanup failed", "error", err)
	} else if removed > 0 {
		c.log.Info("unverified users cleanup", "removed_users", removed)
	}
}

// Run гоняет уборку по таймеру до отмены контекста. Первый проход — сразу на
// старте: если процесс перезапускается чаще интервала, отложенная уборка не
// случилась бы никогда.
func (c *OTPCleaner) Run(ctx context.Context, interval time.Duration) {
	c.RunOnce()

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			c.RunOnce()
		}
	}
}
