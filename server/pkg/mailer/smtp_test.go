package mailer

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/vycord/server/internal/domain"
)

func TestBuildMIMEHasBothParts(t *testing.T) {
	m := &smtpMailer{cfg: Config{From: "noreply@vycord.ru", FromName: "VYCORD"}}

	raw := string(m.buildMIME(domain.MailMessage{
		To:      "user@example.com",
		Subject: "Тема",
		Text:    "текст 0429",
		HTML:    "<p>0429</p>",
	}))

	assert.Contains(t, raw, "From: VYCORD <noreply@vycord.ru>")
	assert.Contains(t, raw, "To: user@example.com")
	assert.Contains(t, raw, "MIME-Version: 1.0")
	assert.Contains(t, raw, "multipart/alternative")
	assert.Contains(t, raw, "text/plain; charset=UTF-8")
	assert.Contains(t, raw, "text/html; charset=UTF-8")
}

// Кириллица в теме обязана быть закодирована по RFC 2047, иначе часть
// почтовиков покажет кракозябры или отправит письмо в спам.
func TestBuildMIMEEncodesSubject(t *testing.T) {
	m := &smtpMailer{cfg: Config{From: "n@v.ru", FromName: "VYCORD"}}

	raw := string(m.buildMIME(domain.MailMessage{To: "u@e.com", Subject: "Тема", Text: "t", HTML: "<p>t</p>"}))

	subjectLine := ""
	for _, line := range strings.Split(raw, "\r\n") {
		if strings.HasPrefix(line, "Subject: ") {
			subjectLine = line
		}
	}
	assert.Contains(t, subjectLine, "=?utf-8?")
	assert.NotContains(t, subjectLine, "Тема")
}
