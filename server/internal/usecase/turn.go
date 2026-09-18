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
	return uc.GetCredentialsForIdentity(userID.String(), uc.ttl)
}

// GetCredentialsForIdentity mints coturn REST credentials for identity with
// the given TTL. The shared TURN secret never leaves the server; the
// credentials cannot be revoked, only expire — hence the short guest TTL.
func (uc *turnUseCase) GetCredentialsForIdentity(identity string, ttl time.Duration) (*domain.TURNCredentials, error) {
	if uc.secret == "" || len(uc.urls) == 0 {
		return nil, nil
	}

	expiry := uc.now().Add(ttl).Unix()
	username := fmt.Sprintf("%d:%s", expiry, identity)

	mac := hmac.New(sha1.New, []byte(uc.secret))
	mac.Write([]byte(username))
	credential := base64.StdEncoding.EncodeToString(mac.Sum(nil))

	return &domain.TURNCredentials{
		URLs:       uc.urls,
		Username:   username,
		Credential: credential,
		TTLSeconds: int(ttl.Seconds()),
	}, nil
}
