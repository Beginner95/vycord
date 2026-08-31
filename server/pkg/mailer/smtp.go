// Package mailer доставляет готовые письма по SMTP. Про OTP, пользователей и
// вообще предметную область не знает ничего — это чистый транспорт за портом
// domain.Mailer.
package mailer

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"mime"
	"net"
	"net/smtp"
	"strings"

	"github.com/vycord/server/internal/domain"
)

type Config struct {
	Host     string
	Port     string
	Username string
	Password string
	From     string
	FromName string
}

type smtpMailer struct {
	cfg Config
}

func NewSMTP(cfg Config) domain.Mailer {
	return &smtpMailer{cfg: cfg}
}

func (m *smtpMailer) Send(msg domain.MailMessage) error {
	addr := net.JoinHostPort(m.cfg.Host, m.cfg.Port)

	// Аутентификация опциональна: часть релеев (в том числе локальный
	// MailHog в docker-compose для разработки) её не требует, и передавать
	// туда nil-auth — единственный способ с ними заговорить.
	var auth smtp.Auth
	if m.cfg.Username != "" {
		auth = smtp.PlainAuth("", m.cfg.Username, m.cfg.Password, m.cfg.Host)
	}

	if err := smtp.SendMail(addr, auth, m.cfg.From, []string{msg.To}, m.buildMIME(msg)); err != nil {
		// Тело письма в ошибку не попадает: в нём код.
		return fmt.Errorf("smtp send to %s failed: %w", msg.To, err)
	}
	return nil
}

// buildMIME собирает multipart/alternative: текстовая часть для почтовиков
// без HTML и антиспам-фильтров, HTML — для людей. Письмо только с HTML
// заметно чаще попадает в спам.
func (m *smtpMailer) buildMIME(msg domain.MailMessage) []byte {
	boundary := randomBoundary()

	var b strings.Builder
	b.WriteString(fmt.Sprintf("From: %s <%s>\r\n", m.cfg.FromName, m.cfg.From))
	b.WriteString(fmt.Sprintf("To: %s\r\n", msg.To))
	b.WriteString(fmt.Sprintf("Subject: %s\r\n", mime.QEncoding.Encode("utf-8", msg.Subject)))
	b.WriteString("MIME-Version: 1.0\r\n")
	b.WriteString(fmt.Sprintf("Content-Type: multipart/alternative; boundary=%s\r\n\r\n", boundary))

	b.WriteString(fmt.Sprintf("--%s\r\n", boundary))
	b.WriteString("Content-Type: text/plain; charset=UTF-8\r\n\r\n")
	b.WriteString(msg.Text)
	b.WriteString("\r\n")

	b.WriteString(fmt.Sprintf("--%s\r\n", boundary))
	b.WriteString("Content-Type: text/html; charset=UTF-8\r\n\r\n")
	b.WriteString(msg.HTML)
	b.WriteString("\r\n")

	b.WriteString(fmt.Sprintf("--%s--\r\n", boundary))
	return []byte(b.String())
}

func randomBoundary() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		// Граница не секрет — она лишь не должна встретиться в теле письма.
		// Тело у нас порождается сервером, так что фиксированный запасной
		// вариант безопасен.
		return "vycord-boundary-fallback"
	}
	return hex.EncodeToString(buf)
}
