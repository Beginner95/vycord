package domain_test

import (
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/vycord/server/internal/domain"
)

// OTPThrottledError разбирается через errors.As, потому что хендлеру нужно
// не только «отказано», но и сколько секунд писать в Retry-After.
func TestOTPThrottledErrorCarriesRetryAfter(t *testing.T) {
	var err error = &domain.OTPThrottledError{RetryAfter: 42 * time.Second, Hourly: true}

	var throttled *domain.OTPThrottledError
	assert.True(t, errors.As(err, &throttled))
	assert.Equal(t, 42*time.Second, throttled.RetryAfter)
	assert.True(t, throttled.Hourly)
	assert.NotEmpty(t, err.Error())
}

func TestOTPPurposeValues(t *testing.T) {
	assert.Equal(t, domain.OTPPurpose("registration"), domain.OTPPurposeRegistration)
	assert.Equal(t, domain.OTPPurpose("login"), domain.OTPPurposeLogin)
}
