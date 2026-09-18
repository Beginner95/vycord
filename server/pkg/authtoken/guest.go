package authtoken

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

// Labels for keys derived from JWT_SECRET. One key per purpose: a guest room
// token signed with GuestRoomKeyLabel's key cannot verify under the main key
// (RequireAuth, /ws hub, the SFU's account path) — rejection is cryptographic,
// not a claim check someone could forget. See
// docs/superpowers/specs/2026-09-17-guest-call-link-design.md, section 1.
const (
	GuestRoomKeyLabel = "vycord/guest-room/v1"
	GuestIPKeyLabel   = "vycord/guest-ip/v1"
)

// GuestIdentityPrefix marks a guest's participant identity inside the SFU and
// in call events. It can never collide with a user's UUID string.
const GuestIdentityPrefix = "guest:"

var errInvalidGuestToken = errors.New("invalid guest room token")

// DeriveKey returns HMAC-SHA256(secret, label): a 32-byte key bound to one
// purpose. Both the API and the SFU derive the same key from the shared
// JWT_SECRET, so no new environment variable is needed.
func DeriveKey(secret, label string) []byte {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(label))
	return mac.Sum(nil)
}

// GuestRoomClaims is the verified content of a guest room token.
type GuestRoomClaims struct {
	GuestID   uuid.UUID
	RoomID    uuid.UUID
	JTI       string
	ExpiresAt time.Time
}

// GenerateGuestRoomToken signs a short-lived, single-room token for an
// admitted guest. It deliberately carries no user_id; jti lets the SFU refuse
// a second use of the same token.
func GenerateGuestRoomToken(secret string, guestID, roomID uuid.UUID, ttl time.Duration) (string, error) {
	jti, err := randomBase64URL(16)
	if err != nil {
		return "", fmt.Errorf("failed to generate jti: %w", err)
	}
	now := time.Now()
	claims := jwt.MapClaims{
		"typ":      TypGuestRoom,
		"guest_id": guestID.String(),
		"room_id":  roomID.String(),
		"jti":      jti,
		"iat":      now.Unix(),
		"exp":      now.Add(ttl).Unix(),
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).
		SignedString(DeriveKey(secret, GuestRoomKeyLabel))
}

// ValidateGuestRoomToken verifies a guest room token against the derived
// guest key. Unlike the account validators there is no untyped transition:
// guest tokens are new, so typ must be exactly "guest_room", exp is required,
// and a user_id claim is grounds for rejection.
func ValidateGuestRoomToken(secret, tokenString string) (GuestRoomClaims, error) {
	claims, err := parseClaimsWithKey(DeriveKey(secret, GuestRoomKeyLabel), tokenString, jwt.WithExpirationRequired())
	if err != nil {
		return GuestRoomClaims{}, err
	}
	if typ, ok := claims["typ"].(string); !ok || typ != TypGuestRoom {
		return GuestRoomClaims{}, errWrongTokenType
	}
	if _, ok := claims["user_id"]; ok {
		return GuestRoomClaims{}, errInvalidGuestToken
	}

	guestID, err := uuidClaim(claims, "guest_id")
	if err != nil {
		return GuestRoomClaims{}, err
	}
	roomID, err := uuidClaim(claims, "room_id")
	if err != nil {
		return GuestRoomClaims{}, err
	}
	jti, ok := claims["jti"].(string)
	if !ok || jti == "" {
		return GuestRoomClaims{}, errInvalidGuestToken
	}
	exp, err := claims.GetExpirationTime()
	if err != nil || exp == nil {
		return GuestRoomClaims{}, errInvalidGuestToken
	}

	return GuestRoomClaims{GuestID: guestID, RoomID: roomID, JTI: jti, ExpiresAt: exp.Time}, nil
}

func uuidClaim(claims jwt.MapClaims, name string) (uuid.UUID, error) {
	raw, ok := claims[name].(string)
	if !ok {
		return uuid.Nil, fmt.Errorf("missing or invalid %s claim", name)
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		return uuid.Nil, fmt.Errorf("invalid %s claim", name)
	}
	return id, nil
}

// GuestIdentity returns the participant identity a guest uses in the SFU and
// in call events: "guest:<uuid>".
func GuestIdentity(guestID uuid.UUID) string {
	return GuestIdentityPrefix + guestID.String()
}

// ParseGuestIdentity reports whether identity is a guest identity and returns
// its guest ID. The prefix is case-sensitive and nothing may surround it.
func ParseGuestIdentity(identity string) (uuid.UUID, bool) {
	rest, ok := strings.CutPrefix(identity, GuestIdentityPrefix)
	if !ok {
		return uuid.Nil, false
	}
	id, err := uuid.Parse(rest)
	if err != nil || id.String() != rest {
		return uuid.Nil, false
	}
	return id, true
}

// GenerateOpaqueSecret returns 32 random bytes, base64url without padding —
// the format of guest link secrets and guest session tokens. It is not a JWT,
// so every JWT validator rejects it at parse.
func GenerateOpaqueSecret() (string, error) {
	return randomBase64URL(32)
}

// HashOpaqueSecret returns SHA-256(s), the only form in which opaque secrets
// are persisted.
func HashOpaqueSecret(s string) []byte {
	sum := sha256.Sum256([]byte(s))
	return sum[:]
}

func randomBase64URL(n int) (string, error) {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}
