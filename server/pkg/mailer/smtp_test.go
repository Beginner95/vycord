package mailer

import (
	"io"
	"mime/quotedprintable"
	"regexp"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
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

// Без явного Content-Transfer-Encoding умолчание по RFC 2045 — 7bit, то
// есть «в теле только ASCII». Тело у нас кириллическое (восьмибитное), и
// net/smtp.SendMail не согласовывает 8BITMIME, так что без перекодирования
// письмо уезжает с ложным объявлением кодировки. Проверяем не только
// наличие заголовка, но и что закодированные байты действительно чистый
// ASCII, и что раскодирование даёт обратно исходный текст — то есть
// перекодирование не портит содержимое.
func TestBuildMIMEEncodesBodyAsQuotedPrintable(t *testing.T) {
	m := &smtpMailer{cfg: Config{From: "n@v.ru", FromName: "VYCORD"}}

	raw := string(m.buildMIME(domain.MailMessage{
		To:      "u@e.com",
		Subject: "Тема",
		Text:    "код 0429, привет",
		HTML:    "<p>код 0429, привет</p>",
	}))

	// (а) заголовок объявлен у обеих частей.
	assert.Equal(t, 2, strings.Count(raw, "Content-Transfer-Encoding: quoted-printable\r\n"),
		"обе части должны объявлять quoted-printable")

	// mime/multipart сам прозрачно раскодирует quoted-printable-тело и
	// прячет заголовок при чтении части (см. mime/multipart.Part.Read) —
	// это удобно для получателя письма, но непригодно для проверки (б):
	// нам нужны байты ровно в том виде, в каком они уйдут по проводу.
	// Поэтому границы находим и режем сами.
	boundary := regexp.MustCompile(`boundary=([0-9a-f]+)`).FindStringSubmatch(raw)
	require.Len(t, boundary, 2, "не нашли boundary в Content-Type")

	rawParts := strings.Split(raw, "--"+boundary[1])
	require.Len(t, rawParts, 4, "ожидались преамбула, две части и финальная граница")

	for _, part := range rawParts[1:3] {
		headerAndBody := strings.SplitN(part, "\r\n\r\n", 2)
		require.Len(t, headerAndBody, 2)
		encodedBody := strings.TrimSuffix(headerAndBody[1], "\r\n")

		// (б) закодированные байты — чистый ASCII: в них не должно
		// остаться сырых восьмибитных октетов UTF-8.
		assert.True(t, isASCII([]byte(encodedBody)),
			"закодированное тело части должно быть чистым ASCII (< 0x80)")

		// (в) декодирование обратно даёт исходный текст — перекодирование
		// не испортило содержимое.
		decoded, err := io.ReadAll(quotedprintable.NewReader(strings.NewReader(encodedBody)))
		require.NoError(t, err)
		assert.Contains(t, string(decoded), "0429")
		assert.Contains(t, string(decoded), "привет")
	}
}

func isASCII(b []byte) bool {
	for _, c := range b {
		if c >= 0x80 {
			return false
		}
	}
	return true
}

// Адрес с CR/LF внутри — классическая инъекция заголовков (подсадка своего
// Bcc:). Send обязан отвергнуть его до похода в сеть и не притащить сам
// адрес (а значит и внедрённые заголовки) в текст ошибки.
func TestSendRejectsRecipientWithControlChars(t *testing.T) {
	m := &smtpMailer{cfg: Config{Host: "localhost", Port: "25", From: "n@v.ru", FromName: "VYCORD"}}

	err := m.Send(domain.MailMessage{
		To:      "victim@example.com\r\nBcc: attacker@evil.com",
		Subject: "s",
		Text:    "t",
		HTML:    "<p>t</p>",
	})

	require.Error(t, err)
	assert.NotContains(t, err.Error(), "attacker@evil.com")
}
