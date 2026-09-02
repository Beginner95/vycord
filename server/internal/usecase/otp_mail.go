package usecase

import (
	"fmt"
	"time"

	"github.com/vycord/server/internal/domain"
)

// renderOTPMessage собирает письмо с кодом. Живёт в юзкейсе, а не в
// pkg/mailer: что написано в письме — прикладное решение, а pkg/mailer
// должен уметь только доставить готовые байты.
//
// Код подставляется как есть и нигде не логируется. HTML собирается
// конкатенацией, а не html/template, потому что все подставляемые значения
// порождены сервером (4 цифры и число минут) — пользовательского ввода в
// письме нет вовсе.
func renderOTPMessage(to, code string, p domain.OTPPurpose, ttl time.Duration) domain.MailMessage {
	minutes := int(ttl.Minutes())
	if minutes < 1 {
		minutes = 1
	}

	subject := "Код для входа в VYCORD"
	action := "Ваш код для входа в аккаунт"
	if p == domain.OTPPurposeRegistration {
		subject = "Подтверждение регистрации в VYCORD"
		action = "Ваш код для подтверждения регистрации"
	}

	text := fmt.Sprintf(
		"%s: %s\n\nКод действует %d мин. Если вы не запрашивали код, просто проигнорируйте это письмо.\n",
		action, code, minutes,
	)

	html := fmt.Sprintf(
		`<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:480px">`+
			`<p style="font-size:15px;color:#2e3338">%s:</p>`+
			`<p style="font-size:32px;font-weight:700;letter-spacing:8px;margin:16px 0">%s</p>`+
			`<p style="font-size:13px;color:#747f8d">Код действует %d мин. `+
			`Если вы не запрашивали код, просто проигнорируйте это письмо.</p></div>`,
		action, code, minutes,
	)

	return domain.MailMessage{To: to, Subject: subject, Text: text, HTML: html}
}
