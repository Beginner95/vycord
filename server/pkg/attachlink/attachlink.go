// Package attachlink подписывает ссылки на вложения.
//
// Теги <img> и <video> не умеют отправлять заголовок Authorization, поэтому
// доступ к файлу даёт подпись прямо в URL: HMAC-SHA256 от "id|exp" на общем
// секрете (JWT_SECRET). Ссылка протухает, так что утёкший адрес не даёт
// доступа навсегда.
package attachlink

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/google/uuid"
)

var (
	// ErrLinkExpired — подпись верна, но срок её действия истёк.
	ErrLinkExpired = errors.New("attachment link expired")
	// ErrLinkInvalid — подписи нет, она не сходится либо exp испорчен.
	ErrLinkInvalid = errors.New("attachment link invalid")
)

type Signer struct {
	secret []byte
	ttl    time.Duration
	// Now подменяется в тестах.
	Now func() time.Time
}

func NewSigner(secret string, ttl time.Duration) *Signer {
	return &Signer{secret: []byte(secret), ttl: ttl, Now: time.Now}
}

func (s *Signer) ContentURL(id uuid.UUID) string {
	return s.sign("/api/v1/attachments/"+id.String()+"/content", id)
}

func (s *Signer) ThumbURL(id uuid.UUID) string {
	return s.sign("/api/v1/attachments/"+id.String()+"/thumb", id)
}

func (s *Signer) sign(path string, id uuid.UUID) string {
	exp := s.Now().Add(s.ttl).Unix()
	return fmt.Sprintf("%s?exp=%d&sig=%s", path, exp, s.mac(id, exp))
}

// Verify проверяет подпись и срок. Порядок важен: сначала подпись, потом срок,
// иначе по разнице ответов можно отличить «подпись верна» от «подпись неверна»
// для произвольного exp.
func (s *Signer) Verify(id uuid.UUID, exp, sig string) error {
	expUnix, err := strconv.ParseInt(exp, 10, 64)
	if err != nil {
		return fmt.Errorf("parse exp: %w", ErrLinkInvalid)
	}

	want := s.mac(id, expUnix)
	if !hmac.Equal([]byte(want), []byte(sig)) {
		return ErrLinkInvalid
	}

	if s.Now().After(time.Unix(expUnix, 0)) {
		return ErrLinkExpired
	}
	return nil
}

func (s *Signer) mac(id uuid.UUID, exp int64) string {
	m := hmac.New(sha256.New, s.secret)
	m.Write([]byte(id.String()))
	m.Write([]byte("|"))
	m.Write([]byte(strconv.FormatInt(exp, 10)))
	return hex.EncodeToString(m.Sum(nil))
}
