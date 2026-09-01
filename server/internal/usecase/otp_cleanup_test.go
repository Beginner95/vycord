package usecase_test

import (
	"errors"
	"log/slog"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/vycord/server/internal/usecase"
)

func TestCleanerRemovesExpiredCodesAndStaleRegistrations(t *testing.T) {
	otpRepo := new(MockOTPRepository)
	userRepo := new(MockUserRepository)
	otpRepo.On("DeleteExpiredBefore", mock.Anything).Return(int64(7), nil)
	userRepo.On("DeleteUnverifiedBefore", mock.Anything).Return(int64(2), nil)

	usecase.NewOTPCleaner(otpRepo, userRepo, 168*time.Hour, slog.Default()).RunOnce()

	otpRepo.AssertCalled(t, "DeleteExpiredBefore", mock.Anything)
	userRepo.AssertCalled(t, "DeleteUnverifiedBefore", mock.Anything)
}

// Сбой одной уборки не должен отменять вторую: это независимые задачи,
// и падение одной не повод копить мусор по другой.
func TestCleanerContinuesAfterCodeCleanupFailure(t *testing.T) {
	otpRepo := new(MockOTPRepository)
	userRepo := new(MockUserRepository)
	otpRepo.On("DeleteExpiredBefore", mock.Anything).Return(int64(0), errors.New("db down"))
	userRepo.On("DeleteUnverifiedBefore", mock.Anything).Return(int64(1), nil)

	assert.NotPanics(t, func() {
		usecase.NewOTPCleaner(otpRepo, userRepo, time.Hour, slog.Default()).RunOnce()
	})

	userRepo.AssertCalled(t, "DeleteUnverifiedBefore", mock.Anything)
}
