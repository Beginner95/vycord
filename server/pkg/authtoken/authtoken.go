// Package authtoken validates the JWT tokens issued by the API's auth
// use-case. It is shared by every service that needs to check a token
// against the common JWT_SECRET without a database round-trip (API
// middleware, SFU signaling).
package authtoken

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

// Token kinds, carried in the "typ" claim. A validator accepts exactly one
// kind: before typ existed, a 60-second voice (room) token carried user_id and
// therefore passed ValidateToken — i.e. worked against RequireAuth and the /ws
// hub. See docs/superpowers/specs/2026-09-17-guest-call-link-design.md,
// section 1 «Тип токена».
const (
	TypAccess    = "access"
	TypRoom      = "room"
	TypGuestRoom = "guest_room"
)

// acceptUntypedTokens keeps tokens issued by the release before typ existed
// valid across the deploy: access tokens live JWT_EXPIRATION (15 min by
// default), room tokens 60 s. Flip to false one release later — tracked in
// docs/superpowers/backlog/2026-09-17-token-typ-mandatory.md.
//
// It never lets a room- or guest-scoped token through ValidateToken: those are
// rejected by their room_id / guest_id claim regardless of typ.
const acceptUntypedTokens = true

var errWrongTokenType = errors.New("wrong token type")

// checkTyp requires the typ claim to equal want. A missing typ is accepted
// only while acceptUntypedTokens is on; a present-but-wrong or non-string typ
// is always rejected.
func checkTyp(claims jwt.MapClaims, want string) error {
	raw, present := claims["typ"]
	if !present {
		if acceptUntypedTokens {
			return nil
		}
		return errWrongTokenType
	}
	typ, ok := raw.(string)
	if !ok || typ != want {
		return errWrongTokenType
	}
	return nil
}

func parseClaims(secret, tokenString string) (jwt.MapClaims, error) {
	return parseClaimsWithKey([]byte(secret), tokenString)
}

// parseClaimsWithKey verifies an HMAC-signed token against key. Only HMAC
// methods are accepted — anything else, including alg=none, is rejected.
func parseClaimsWithKey(key []byte, tokenString string, opts ...jwt.ParserOption) (jwt.MapClaims, error) {
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return key, nil
	}, opts...)
	if err != nil {
		return nil, fmt.Errorf("invalid token: %w", err)
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid token claims")
	}
	return claims, nil
}

func userIDFromClaims(claims jwt.MapClaims) (uuid.UUID, error) {
	rawID, ok := claims["user_id"].(string)
	if !ok {
		return uuid.Nil, fmt.Errorf("missing or invalid user_id claim")
	}
	userID, err := uuid.Parse(rawID)
	if err != nil {
		return uuid.Nil, fmt.Errorf("invalid user id in token")
	}
	return userID, nil
}

// ValidateToken parses tokenString, verifies its HMAC signature and standard
// claims (including exp) against secret, and returns the user ID from the
// user_id claim. Only HMAC signing methods are accepted — anything else,
// including alg=none, is rejected. Tokens carrying room_id or guest_id, or a
// typ other than "access", are rejected too.
func ValidateToken(secret, tokenString string) (uuid.UUID, error) {
	claims, err := parseClaims(secret, tokenString)
	if err != nil {
		return uuid.Nil, err
	}
	// A token scoped to a room or to a guest is never an access token, typed
	// or not — this is what closes the untyped-legacy-room-token path.
	if _, ok := claims["room_id"]; ok {
		return uuid.Nil, errWrongTokenType
	}
	if _, ok := claims["guest_id"]; ok {
		return uuid.Nil, errWrongTokenType
	}
	if err := checkTyp(claims, TypAccess); err != nil {
		return uuid.Nil, err
	}
	return userIDFromClaims(claims)
}

// GenerateRoomToken signs a short-lived token scoped to a single SFU room.
// Used by the API to authorize a voice-channel connection without giving the
// SFU process direct database access — see
// docs/superpowers/specs/2026-08-04-private-channels-design.md.
func GenerateRoomToken(secret string, userID, roomID uuid.UUID, ttl time.Duration) (string, error) {
	claims := jwt.MapClaims{
		"typ":     TypRoom,
		"user_id": userID.String(),
		"room_id": roomID.String(),
		"exp":     time.Now().Add(ttl).Unix(),
		"iat":     time.Now().Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

// ValidateRoomToken validates tokenString like ValidateToken, additionally
// requiring a room_id claim — tokens without one (e.g. the general-purpose
// login token) are rejected. Used by the SFU signaling handler.
func ValidateRoomToken(secret, tokenString string) (userID, roomID uuid.UUID, err error) {
	claims, err := parseClaims(secret, tokenString)
	if err != nil {
		return uuid.Nil, uuid.Nil, err
	}
	if err := checkTyp(claims, TypRoom); err != nil {
		return uuid.Nil, uuid.Nil, err
	}
	userID, err = userIDFromClaims(claims)
	if err != nil {
		return uuid.Nil, uuid.Nil, err
	}
	rawRoom, ok := claims["room_id"].(string)
	if !ok {
		return uuid.Nil, uuid.Nil, fmt.Errorf("missing or invalid room_id claim")
	}
	roomID, err = uuid.Parse(rawRoom)
	if err != nil {
		return uuid.Nil, uuid.Nil, fmt.Errorf("invalid room id in token")
	}
	return userID, roomID, nil
}

// GenerateRefreshToken returns a new cryptographically random opaque
// refresh-token string (32 random bytes, hex-encoded — 64 characters).
// Unlike access tokens it carries no claims: validity lives entirely in
// the refresh_tokens table, keyed by HashRefreshToken's output.
func GenerateRefreshToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("failed to generate refresh token: %w", err)
	}
	return hex.EncodeToString(buf), nil
}

// HashRefreshToken returns the SHA-256 hash of a refresh-token string, as
// stored in refresh_tokens.token_hash. The raw token is never persisted.
func HashRefreshToken(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}
