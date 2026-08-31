package usecase

import (
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/vycord/server/internal/domain"
)

func TestRenderOTPMessageContainsCodeAndTTL(t *testing.T) {
	msg := renderOTPMessage("user@example.com", "0429", domain.OTPPurposeRegistration, 5*time.Minute)

	assert.Equal(t, "user@example.com", msg.To)
	assert.NotEmpty(t, msg.Subject)
	assert.Contains(t, msg.Text, "0429")
	assert.Contains(t, msg.HTML, "0429")
	assert.Contains(t, msg.Text, "5")
}

// Разные поводы — разные письма: «подтвердите регистрацию» и «вход в аккаунт»
// не должны выглядеть одинаково, иначе фишинг проще, а пользователь не
// понимает, что он вообще подтверждает.
func TestRenderOTPMessageDiffersByPurpose(t *testing.T) {
	reg := renderOTPMessage("u@e.com", "1111", domain.OTPPurposeRegistration, time.Minute)
	login := renderOTPMessage("u@e.com", "1111", domain.OTPPurposeLogin, time.Minute)

	assert.NotEqual(t, reg.Subject, login.Subject)
}

// В письме не должно быть незакрытых подстановок шаблона.
func TestRenderOTPMessageHasNoPlaceholders(t *testing.T) {
	msg := renderOTPMessage("u@e.com", "1111", domain.OTPPurposeLogin, time.Minute)

	assert.False(t, strings.Contains(msg.HTML, "{{"))
	assert.False(t, strings.Contains(msg.Text, "{{"))
}
