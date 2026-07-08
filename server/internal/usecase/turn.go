package usecase

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/domain"
)

type turnUseCase struct {
	secret string
	urls   []string
	ttl    time.Duration
	now    func() time.Time
}

func NewTURNUseCase(secret string, urls []string, ttl time.Duration) domain.TURNUseCase {
	return &turnUseCase{
		secret: secret,
		urls:   urls,
		ttl:    ttl,
		now:    time.Now,
	}
}

// GetCredentials returns ephemeral TURN credentials for the given user.
// Returns (nil, nil) when TURN is not configured — callers should fall back
// to STUN-only ICE.
func (uc *turnUseCase) GetCredentials(userID uuid.UUID) (*domain.TURNCredentials, error) {
	if uc.secret == "" || len(uc.urls) == 0 {
		return nil, nil
	}

	expiry := uc.now().Add(uc.ttl).Unix()
	username := fmt.Sprintf("%d:%s", expiry, userID)

	mac := hmac.New(sha1.New, []byte(uc.secret))
	mac.Write([]byte(username))
	credential := base64.StdEncoding.EncodeToString(mac.Sum(nil))

	return &domain.TURNCredentials{
		URLs:       uc.urls,
		Username:   username,
		Credential: credential,
		TTLSeconds: int(uc.ttl.Seconds()),
	}, nil
}
